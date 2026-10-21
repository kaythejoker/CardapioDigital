import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canOpenManagerPanel } from "@/lib/permissions";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const input = z
    .object({ email: z.email(), password: z.string().min(1).max(200) })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ error: "Informe e-mail e senha" }, { status: 400 });
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword(input.data);
  return error
    ? Response.json({ error: "E-mail ou senha incorretos" }, { status: 401 })
    : Response.json({ ok: true });
}
export async function DELETE(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const db = await createClient();
  const { error } = await db.auth.signOut();
  return Response.json({ ok: !error }, { status: error ? 503 : 200 });
}
export async function GET() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Faça login" }, { status: 401 });
  const [members, resellers] = await Promise.all([
    db
      .from("restaurant_members")
      .select("restaurant_id,role,roles,permissions,restaurants(name,slug)")
      .eq("user_id", user.id)
      .eq("active", true),
    db.from("reseller_members").select("reseller_id").eq("user_id", user.id),
  ]);
  return Response.json(
    {
      email: user.email,
      members: (members.data ?? []).map((m) => ({
        ...m,
        manager_panel: canOpenManagerPanel(m.roles ?? [], m.permissions),
      })),
      resellers: resellers.data ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
