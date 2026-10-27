import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type WaitlistTicket = {
  number: number;
  name: string;
  party_size: number;
  status: "aguardando" | "chamado" | "sentado" | "desistiu";
  ahead: number;
  created_at: string;
  called_at: string | null;
  restaurant: {
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    background_color: string | null;
    languages: boolean;
    brand: { brand_name: string; logo_url: string | null; primary_color: string };
  };
};

/** Página pública da espera: só pela rota do servidor, com a chave secreta. */
export async function loadWaitlistTicket(slug: string, token: string) {
  const { data, error } = await createAdminClient().rpc("waitlist_status", {
    p_slug: slug,
    p_token: token,
  });
  if (error) throw error;
  return (data ?? null) as WaitlistTicket | null;
}
