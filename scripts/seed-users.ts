/**
 * Cria as contas de demonstração da equipe e da revenda no Supabase Auth e as
 * vincula aos restaurantes do seed. Pode rodar mais de uma vez.
 *
 * Uso: SEED_USER_PASSWORD=... npm run db:seed-users
 * (lê NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY do .env.local)
 */
import { createClient } from "@supabase/supabase-js";

const BRASA = "20000000-0000-4000-8000-000000000001";
const CANTINA = "20000000-0000-4000-8000-000000000002";
const RESELLER = "10000000-0000-4000-8000-000000000001";

type Account =
  | { email: string; name: string; reseller: string }
  | { email: string; name: string; restaurant: string; role: "manager" | "waiter" | "kitchen" };

const accounts: Account[] = [
  { email: "revenda@comanda.dev", name: "Felipe", reseller: RESELLER },
  { email: "gestor@brasa.dev", name: "Marina", restaurant: BRASA, role: "manager" },
  { email: "garcom@brasa.dev", name: "João", restaurant: BRASA, role: "waiter" },
  { email: "cozinha@brasa.dev", name: "Cozinha Brasa", restaurant: BRASA, role: "kitchen" },
  { email: "gestor@cantina.dev", name: "Giulia", restaurant: CANTINA, role: "manager" },
];

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Defina ${name}`);
  return value;
}

async function main() {
  const password = env("SEED_USER_PASSWORD");
  const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  for (const account of accounts) {
    let userId = existing.users.find((u) => u.email === account.email)?.id;
    if (!userId) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: { name: account.name },
      });
      if (error) throw error;
      userId = data.user.id;
    }

    const { error } =
      "reseller" in account
        ? await supabase
            .from("reseller_members")
            .upsert({ user_id: userId, reseller_id: account.reseller })
        : await supabase
            .from("restaurant_members")
            .upsert({ user_id: userId, restaurant_id: account.restaurant, role: account.role });
    if (error) throw error;

    console.log(`ok ${account.email}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
