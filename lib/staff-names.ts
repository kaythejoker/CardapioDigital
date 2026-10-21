import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Nomes da equipe para o histórico e os relatórios, sem expor e-mails no cliente. */
export async function staffNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return {} as Record<string, string>;
  const admin = createAdminClient();
  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      const name = data.user?.user_metadata?.name;
      return [id, typeof name === "string" && name ? name : (data.user?.email?.split("@")[0] ?? "Equipe")] as const;
    }),
  );
  return Object.fromEntries(entries);
}
