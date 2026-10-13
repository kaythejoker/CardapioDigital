import { z } from "zod";
import { resellerAccess } from "@/lib/manage-access";
import { imageUrl } from "@/lib/manage-schema";

export async function GET() {
  const ctx = await resellerAccess();
  if (!ctx)
    return Response.json(
      { error: "Acesso da revenda necessário" },
      { status: 403 },
    );
  const { data, error } = await ctx.db
    .from("restaurants")
    .select("*")
    .eq("reseller_id", ctx.resellerId)
    .order("created_at", { ascending: false });
  return error
    ? Response.json(
        { error: "Não foi possível carregar restaurantes" },
        { status: 503 },
      )
    : Response.json(
        { reseller: ctx.reseller, restaurants: data },
        { headers: { "Cache-Control": "no-store" } },
      );
}
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  }),
  z.object({
    action: z.literal("status"),
    id: z.uuid(),
    status: z.enum(["active", "inactive"]),
  }),
  z.object({
    action: z.literal("brand"),
    name: z.string().trim().min(1).max(100),
    brand_name: z.string().trim().min(1).max(100),
    logo_url: imageUrl,
    primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    domain: z
      .union([
        z.literal(""),
        z
          .string()
          .max(253)
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
        z.null(),
      ])
      .transform((v) => v || null),
  }),
]);
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const input = command.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "Confira os dados, o endereço e a cor da marca" },
      { status: 400 },
    );
  const ctx = await resellerAccess();
  if (!ctx) return Response.json({ error: "Acesso negado" }, { status: 403 });
  const cmd = input.data;
  const result =
    cmd.action === "create"
      ? await ctx.db
          .from("restaurants")
          .insert({
            reseller_id: ctx.resellerId,
            name: cmd.name,
            slug: cmd.slug,
          })
          .select("*")
          .single()
      : cmd.action === "status"
        ? await ctx.db
            .from("restaurants")
            .update({ status: cmd.status })
            .eq("id", cmd.id)
            .eq("reseller_id", ctx.resellerId)
            .select("id")
            .maybeSingle()
        : await ctx.db
            .from("resellers")
            .update({
              name: cmd.name,
              brand_name: cmd.brand_name,
              logo_url: cmd.logo_url,
              primary_color: cmd.primary_color,
              domain: cmd.domain,
            })
            .eq("id", ctx.resellerId)
            .select("id")
            .single();
  if (result.error || !result.data)
    return Response.json(
      {
        error:
          result.error?.code === "23505"
            ? "Esse endereço já está em uso"
            : "Não foi possível salvar",
      },
      { status: 409 },
    );
  return Response.json({ ok: true, data: result.data });
}
