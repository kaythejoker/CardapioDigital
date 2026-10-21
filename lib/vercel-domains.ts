import "server-only";
import { z } from "zod";

/**
 * Domínios no projeto público da Vercel (cardapio-cliente). Precisa de
 * VERCEL_TOKEN (token da conta, criado em Account Settings → Tokens),
 * VERCEL_PROJECT_ID_MENU (projeto do cardápio público) e VERCEL_TEAM_ID.
 * Sem o token, as telas mostram que a integração não está configurada e o
 * DNS pode ser apontado por fora; o status fica "pendente".
 */
const env = () => {
  const parsed = z
    .object({
      VERCEL_TOKEN: z.string().min(10),
      VERCEL_PROJECT_ID_MENU: z.string().min(3),
      VERCEL_TEAM_ID: z.string().optional(),
    })
    .safeParse(process.env);
  return parsed.success ? parsed.data : null;
};

export const domainsConfigured = () => env() !== null;

async function call(path: string, init?: RequestInit) {
  const cfg = env();
  if (!cfg) throw new Error("Integração com a Vercel não configurada (VERCEL_TOKEN)");
  const url = new URL(`https://api.vercel.com${path}`);
  if (cfg.VERCEL_TEAM_ID) url.searchParams.set("teamId", cfg.VERCEL_TEAM_ID);
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.VERCEL_TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 404 && response.status !== 409)
    throw new Error(body?.error?.message || `Vercel respondeu ${response.status}`);
  return { status: response.status, body };
}

export type DomainStatus = {
  status: "pending" | "verifying" | "active" | "error";
  /** O que apontar no DNS. */
  instructions: { type: "CNAME" | "A" | "TXT"; name: string; value: string }[];
  error: string | null;
};

const isApex = (domain: string) => domain.split(".").length === 2;

/** Registra (idempotente) e devolve o status atual com as instruções de DNS. */
export async function addDomain(domain: string): Promise<DomainStatus> {
  const cfg = env()!;
  await call(`/v10/projects/${cfg.VERCEL_PROJECT_ID_MENU}/domains`, { method: "POST", body: JSON.stringify({ name: domain }) });
  return checkDomain(domain);
}

export async function removeDomain(domain: string) {
  const cfg = env()!;
  await call(`/v9/projects/${cfg.VERCEL_PROJECT_ID_MENU}/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
}

export async function checkDomain(domain: string): Promise<DomainStatus> {
  const cfg = env()!;
  const [project, config] = await Promise.all([
    call(`/v9/projects/${cfg.VERCEL_PROJECT_ID_MENU}/domains/${encodeURIComponent(domain)}`),
    call(`/v6/domains/${encodeURIComponent(domain)}/config`),
  ]);
  if (project.status === 404)
    return { status: "error", instructions: dnsFor(domain), error: "Domínio não registrado na Vercel. Salve de novo para registrar." };
  const instructions: DomainStatus["instructions"] = dnsFor(domain, config.body?.recommendedCNAME?.[0]?.value, config.body?.recommendedIPv4?.[0]?.value?.[0]);
  for (const v of project.body?.verification ?? [])
    if (v.type && v.domain && v.value) instructions.push({ type: String(v.type).toUpperCase() as "TXT", name: v.domain, value: v.value });
  const verified = project.body?.verified === true;
  const misconfigured = config.body?.misconfigured === true;
  if (verified && !misconfigured) return { status: "active", instructions, error: null };
  if (!verified) return { status: "verifying", instructions, error: "A Vercel ainda não confirmou que o domínio é seu. Adicione os registros e verifique de novo." };
  return { status: "pending", instructions, error: "DNS ainda não aponta para a Vercel. Pode levar até algumas horas para propagar." };
}

function dnsFor(domain: string, cname = "cname.vercel-dns.com", ipv4 = "76.76.21.21"): DomainStatus["instructions"] {
  return isApex(domain)
    ? [{ type: "A", name: "@", value: ipv4 }]
    : [{ type: "CNAME", name: domain.split(".")[0], value: cname }];
}

/** Instruções sem consultar a Vercel, para quando a integração não está configurada. */
export const offlineInstructions = (domain: string): DomainStatus => ({
  status: "pending",
  instructions: dnsFor(domain),
  error: "Integração com a Vercel não configurada: aponte o DNS e peça à equipe técnica para adicionar o domínio ao projeto cardapio-cliente.",
});
