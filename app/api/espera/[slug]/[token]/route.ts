import { z } from "zod";
import { loadWaitlistTicket } from "@/lib/waitlist";

const paramsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  token: z.uuid(),
});

/** Posição do grupo na lista de espera (spec-fase3.md, seção 1). */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/espera/[slug]/[token]">,
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success)
    return Response.json({ error: "Endereço inválido" }, { status: 400 });
  try {
    const ticket = await loadWaitlistTicket(params.data.slug, params.data.token);
    if (!ticket)
      return Response.json({ error: "Este link da lista de espera expirou" }, { status: 404 });
    return Response.json(ticket, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Não foi possível atualizar sua posição" }, { status: 503 });
  }
}
