import { z } from "zod";
import { managerAccess, resellerAccess } from "@/lib/manage-access";
import { addDomain, checkDomain, domainsConfigured, offlineInstructions, removeDomain, type DomainStatus } from "@/lib/vercel-domains";

/**
 * Domínio próprio (spec-fase2.md, seção 7). A revenda cuida do domínio dela;
 * o gestor (com o módulo custom_domain) do domínio do restaurante. O domínio é
 * registrado no projeto público da Vercel; o status da verificação fica no banco.
 */
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Use um domínio como cardapio.suamarca.com.br");
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), kind: z.enum(["reseller", "restaurant"]), restaurant_id: z.uuid().optional(), domain: z.union([z.literal(""), domainSchema]) }),
  z.object({ action: z.literal("check"), kind: z.enum(["reseller", "restaurant"]), restaurant_id: z.uuid().optional() }),
]);

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const input = command.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ error: input.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
  const cmd = input.data;
  try {
    if (cmd.kind === "reseller") {
      const ctx = await resellerAccess();
      if (!ctx) return Response.json({ error: "Acesso negado" }, { status: 403 });
      const current = (ctx.reseller as unknown as { domain: string | null }).domain;
      if (cmd.action === "set") {
        const next = cmd.domain || null;
        if (current && current !== next && domainsConfigured()) await removeDomain(current).catch(() => undefined);
        const { error } = await ctx.db.from("resellers").update({ domain: next }).eq("id", ctx.resellerId);
        if (error) return Response.json({ error: error.code === "23505" ? "Esse domínio já está em uso" : "Não foi possível salvar" }, { status: 409 });
        if (!next) return Response.json({ ok: true, status: null });
        const status = domainsConfigured() ? await addDomain(next) : offlineInstructions(next);
        await ctx.db.from("resellers").update({ domain_status: status.status, domain_checked_at: new Date().toISOString(), domain_error: status.error }).eq("id", ctx.resellerId);
        return Response.json({ ok: true, status });
      }
      if (!current) return Response.json({ error: "Cadastre um domínio primeiro" }, { status: 409 });
      const status = await verify(current);
      await ctx.db.from("resellers").update({ domain_status: status.status, domain_checked_at: new Date().toISOString(), domain_error: status.error }).eq("id", ctx.resellerId);
      return Response.json({ ok: true, status });
    }
    if (!cmd.restaurant_id) return Response.json({ error: "Restaurante inválido" }, { status: 400 });
    const ctx = await managerAccess(cmd.restaurant_id);
    if (!ctx || (!ctx.isManager && !ctx.isReseller)) return Response.json({ error: "Acesso negado" }, { status: 403 });
    if (!ctx.access.features.custom_domain && !ctx.isReseller)
      return Response.json({ error: "Função não incluída no seu plano" }, { status: 403 });
    const current = (ctx.restaurant as { custom_domain: string | null }).custom_domain;
    if (cmd.action === "set") {
      const next = cmd.domain || null;
      if (current && current !== next && domainsConfigured()) await removeDomain(current).catch(() => undefined);
      const { error } = await ctx.db.from("restaurants").update({ custom_domain: next }).eq("id", cmd.restaurant_id);
      if (error) return Response.json({ error: error.code === "23505" ? "Esse domínio já está em uso" : error.message }, { status: 409 });
      if (!next) return Response.json({ ok: true, status: null });
      const status = domainsConfigured() ? await addDomain(next) : offlineInstructions(next);
      await ctx.db.from("restaurants").update({ custom_domain_status: status.status, custom_domain_checked_at: new Date().toISOString(), custom_domain_error: status.error }).eq("id", cmd.restaurant_id);
      return Response.json({ ok: true, status });
    }
    if (!current) return Response.json({ error: "Cadastre um domínio primeiro" }, { status: 409 });
    const status = await verify(current);
    await ctx.db.from("restaurants").update({ custom_domain_status: status.status, custom_domain_checked_at: new Date().toISOString(), custom_domain_error: status.error }).eq("id", cmd.restaurant_id);
    return Response.json({ ok: true, status });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Não foi possível falar com a Vercel" }, { status: 503 });
  }
}

async function verify(domain: string): Promise<DomainStatus> {
  return domainsConfigured() ? checkDomain(domain) : offlineInstructions(domain);
}
