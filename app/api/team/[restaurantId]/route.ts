import { z } from "zod";
import { managerAccess } from "@/lib/manage-access";
import { teamSchema } from "@/lib/manage-schema";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: Request,
  context: RouteContext<"/api/team/[restaurantId]">,
) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const id = z.uuid().safeParse((await context.params).restaurantId);
  const input = teamSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success)
    return Response.json(
      { error: "Confira nome, e-mail e senha (mínimo 12 caracteres)" },
      { status: 400 },
    );
  const ctx = await managerAccess(id.data);
  if (!ctx) return Response.json({ error: "Acesso negado" }, { status: 403 });
  if (input.data.role === "manager" && !ctx.isReseller)
    return Response.json(
      { error: "Apenas a revenda convida gestores" },
      { status: 403 },
    );
  const admin = createAdminClient();
  const { email, name, role, password } = input.data;
  // Existing accounts keep their credentials and memberships in other restaurants.
  let userId: string | undefined;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error)
      return Response.json(
        { error: "Não foi possível verificar a equipe" },
        { status: 503 },
      );
    userId = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    )?.id;
    if (userId || data.users.length < 1000) break;
  }
  let created = false;
  if (userId && !ctx.isReseller) {
    const { data: existing } = await ctx.db
      .from("restaurant_members")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", id.data)
      .maybeSingle();
    if (existing?.role === "manager")
      return Response.json(
        { error: "Apenas a revenda altera o acesso de gestores" },
        { status: 403 },
      );
  }
  if (!userId) {
    const result = password
      ? await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name },
        })
      : await admin.auth.admin.inviteUserByEmail(email, {
          data: { name },
          redirectTo: `${new URL(request.url).origin}/app/aceitar-convite`,
        });
    if (result.error || !result.data.user)
      return Response.json(
        { error: "Não foi possível criar o acesso ou enviar o convite" },
        { status: 409 },
      );
    userId = result.data.user.id;
    created = true;
  }
  const { error } = await ctx.db
    .from("restaurant_members")
    .upsert({ user_id: userId, restaurant_id: id.data, role });
  if (error) {
    if (created) await admin.auth.admin.deleteUser(userId);
    return Response.json(
      { error: "Não foi possível vincular a pessoa ao restaurante" },
      { status: 409 },
    );
  }
  return Response.json({
    ok: true,
    message:
      created && !password
        ? "Convite enviado por e-mail"
        : "Acesso vinculado ao restaurante",
  });
}
