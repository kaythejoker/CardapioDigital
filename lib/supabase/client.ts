import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "./env";

/** Cliente Supabase do navegador, para a equipe (Realtime e Auth). */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
