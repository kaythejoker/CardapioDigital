import { z } from "zod";
import { loadMenu } from "@/lib/menu-data";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/menu/[slug]/[qrToken]">,
) {
  const params = z
    .object({
      slug: z.string().regex(/^[a-z0-9-]+$/),
      qrToken: z.string().regex(/^[a-f0-9]{32}$/),
    })
    .safeParse(await context.params);
  if (!params.success)
    return Response.json({ error: "Endereço inválido" }, { status: 400 });
  try {
    const { slug, qrToken } = params.data;
    const menu = await loadMenu(slug, qrToken);
    if (!menu)
      return Response.json({ error: "Cardápio indisponível" }, { status: 404 });
    return Response.json(menu, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Não foi possível carregar o cardápio" },
      { status: 503 },
    );
  }
}
