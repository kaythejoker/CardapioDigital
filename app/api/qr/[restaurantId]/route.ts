import { z } from "zod";
import { managerAccess } from "@/lib/manage-access";
import { tableQrPdf } from "@/lib/qr-pdf";

export async function GET(
  request: Request,
  context: RouteContext<"/api/qr/[restaurantId]">,
) {
  const id = z.uuid().safeParse((await context.params).restaurantId);
  const tableId = new URL(request.url).searchParams.get("table_id");
  if (!id.success || (tableId && !z.uuid().safeParse(tableId).success))
    return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const ctx = await managerAccess(id.data);
  if (!ctx) return Response.json({ error: "Acesso negado" }, { status: 403 });
  let query = ctx.db
    .from("tables")
    .select("label,qr_token")
    .eq("restaurant_id", id.data)
    .eq("active", true);
  if (tableId) query = query.eq("id", tableId);
  const { data, error } = await query;
  if (error || !data?.length)
    return Response.json(
      { error: "Cadastre uma mesa ativa para gerar o PDF" },
      { status: 409 },
    );
  const configured = process.env.NEXT_PUBLIC_MENU_URL || process.env.NEXT_PUBLIC_APP_URL;
  const origin = configured
    ? new URL(configured).origin
    : new URL(request.url).origin;
  const pdf = await tableQrPdf(
    ctx.restaurant,
    data.toSorted((a, b) =>
      a.label.localeCompare(b.label, "pt-BR", { numeric: true }),
    ),
    origin,
  );
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="mesas-${ctx.restaurant.slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
