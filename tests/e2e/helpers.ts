/** Origem configurada para os testes (painel). */
export const BASE_URL = process.env.QA_BASE_URL || "http://localhost:3000";

let cached: Promise<string> | undefined;

/**
 * Origem onde as páginas e a API do cliente são servidas. Em produção o painel
 * (`APP_SURFACE=admin`) redireciona `/[slug]/m/[qr]` para o projeto público, e
 * o cookie da sessão do cliente só vale nesse host; localmente é a mesma origem.
 */
export function customerOrigin(): Promise<string> {
  cached ??= fetch(`${BASE_URL}/brasa-bistro/m/sonda`, { redirect: "manual" })
    .then((r) => {
      const location = r.headers.get("location");
      return location && r.status >= 300 && r.status < 400 ? new URL(location, BASE_URL).origin : BASE_URL;
    })
    .catch(() => BASE_URL);
  return cached;
}
