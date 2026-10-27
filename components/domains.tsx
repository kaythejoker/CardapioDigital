"use client";
// Domínio próprio da revenda ou do restaurante (spec-fase2.md, seção 7):
// cadastro, instruções de DNS, verificação e status.
import { useState } from "react";
import { actionClass, fieldClass, jsonRequest, panelClass } from "@/components/admin-ui";
import { useI18n } from "@/components/i18n";
import { msg } from "@/lib/i18n";

type Status = { status: "pending" | "verifying" | "active" | "error"; instructions: { type: string; name: string; value: string }[]; error: string | null };
const STATUS_LABEL: Record<Status["status"], string> = { pending: msg("Aguardando DNS"), verifying: msg("Verificando"), active: msg("Ativo"), error: msg("Erro") };

export function DomainPanel({
  kind,
  restaurantId,
  domain,
  status,
  error,
  configured,
  placeholder,
  onChanged,
}: {
  kind: "reseller" | "restaurant";
  restaurantId?: string;
  domain: string | null;
  status: string | null;
  error: string | null;
  configured: boolean;
  placeholder: string;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Status | null>(null);
  const run = async (body: unknown) => {
    setBusy(true);
    setMessage("");
    try {
      const data = await jsonRequest("/api/domains", body);
      setResult(data.status ?? null);
      setMessage(data.status ? (data.status.status === "active" ? msg("Domínio ativo.") : msg("Domínio salvo. Aponte o DNS e verifique.")) : msg("Domínio removido."));
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : msg("Tente novamente"));
    } finally {
      setBusy(false);
    }
  };
  const current = result?.status ?? (status as Status["status"] | null);
  return (
    <section className={`${panelClass} space-y-4`} aria-label={kind === "reseller" ? t("Domínio da revenda") : t("Domínio próprio do restaurante")}>
      <h3 className="font-heading text-2xl">{kind === "reseller" ? t("Domínio da revenda") : t("Domínio próprio")}</h3>
      <p className="text-sm text-muted-foreground">
        {kind === "reseller"
          ? t("Os cardápios de todos os seus restaurantes abrem em /nome-do-restaurante/m/… neste domínio. A URL atual continua funcionando, inclusive nos QR já impressos.")
          : t("A raiz do domínio abre o cardápio para consulta e /m/… abre a mesa. QR codes gerados depois usam o domínio; os antigos continuam valendo.")}
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ action: "set", kind, restaurant_id: restaurantId, domain: String(new FormData(e.currentTarget).get("domain") || "").trim().toLowerCase() });
        }}
      >
        <label className="min-w-64 flex-1">{t("Domínio")}<input name="domain" defaultValue={domain ?? ""} placeholder={placeholder} className={fieldClass} aria-label={kind === "reseller" ? t("Domínio da revenda") : t("Domínio do restaurante")} />
        </label>
        <button disabled={busy} className={actionClass}>{t("Salvar domínio")}</button>
        {domain && (
          <button type="button" disabled={busy} className="rounded-xl border px-4 py-3" onClick={() => void run({ action: "check", kind, restaurant_id: restaurantId })}>{t("Verificar agora")}</button>
        )}
      </form>
      {domain && current && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`domain-status ${current}`}>{STATUS_LABEL[current] ? t(STATUS_LABEL[current]) : current}</span>
          <span className="text-muted-foreground">{domain}</span>
        </p>
      )}
      {(result?.error ?? error) && <p className="text-sm text-[#8c5416]">{result?.error ?? error}</p>}
      {domain && result?.instructions?.length ? (
        <div className="dns-box">
          <b>{t("Aponte no DNS do seu domínio:")}</b>
          <table className="queue-table mt-2"><thead><tr><th>{t("Tipo")}</th><th>{t("Nome")}</th><th>{t("Valor")}</th></tr></thead><tbody>{result.instructions.map((i, n) => <tr key={n}><td>{i.type}</td><td>{i.name}</td><td><code>{i.value}</code></td></tr>)}</tbody></table>
          <small className="text-muted-foreground">{t("O certificado HTTPS é emitido automaticamente quando o DNS propaga.")}</small>
        </div>
      ) : null}
      {!configured && <p className="text-xs text-muted-foreground">{t("Registro automático na Vercel desligado neste ambiente (VERCEL_TOKEN). O status é atualizado quando a integração estiver configurada.")}</p>}
      {message && <p role="status" className="text-sm text-[#2F7D5B]">{t(message)}</p>}
    </section>
  );
}
