import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

/**
 * Variáveis públicas do Supabase. Acessadas por nome literal para que o Next
 * consiga embuti-las no bundle do navegador.
 */
export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

/** Chave secreta (service role). Só pode ser lida no servidor. */
export function secretKey() {
  return z.string().min(1).parse(process.env.SUPABASE_SECRET_KEY);
}
