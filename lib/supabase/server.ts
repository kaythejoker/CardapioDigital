import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "./env";

/**
 * Cliente Supabase da equipe (garçom, cozinha, gestor, revendedor), autenticado
 * pelo cookie de sessão e sujeito ao RLS. Crie um por requisição.
 */
export async function createClient() {
  const env = publicEnv();
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Chamado de um Server Component, que não pode gravar cookies.
            // O proxy.ts renova a sessão, então pode ser ignorado.
          }
        },
      },
    },
  );
}
