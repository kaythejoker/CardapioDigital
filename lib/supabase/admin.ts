import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnv, secretKey } from "./env";

/**
 * Cliente com a chave secreta: ignora o RLS. Usado só em rotas do servidor que
 * atendem o cliente anônimo (cardápio, PIN, pedido), sempre depois de validar
 * a sessão da comanda.
 */
export function createAdminClient() {
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
