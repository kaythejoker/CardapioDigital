"use client";
// Lista de espera do salão (spec-fase3.md, seção 1): cadastrar o grupo, chamar,
// sentar numa mesa livre (abre a comanda) ou marcar desistência. O cliente
// acompanha pelo link ou QR do próprio número.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { BellRing, Check, Copy, MessageCircle, QrCode, Undo2, UserPlus, Users, X } from "lucide-react";
import type { Translate } from "@/lib/i18n";

export type WaitlistEntry = {
  id: string;
  number: number;
  name: string;
  party_size: number;
  phone: string | null;
  note: string | null;
  status: "aguardando" | "chamado" | "sentado" | "desistiu";
  public_token: string;
  table_id: string | null;
  created_at: string;
  called_at: string | null;
  seated_at: string | null;
  left_at: string | null;
};
type Command = (body: Record<string, unknown>) => Promise<unknown>;

/** Link público do número, na origem do cardápio. */
export function waitlistLink(slug: string, token: string) {
  const origin = process.env.NEXT_PUBLIC_MENU_URL || (typeof window === "undefined" ? "" : window.location.origin);
  return `${origin.replace(/\/$/, "")}/${slug}/espera/${token}`;
}

/** wa.me só aceita dígitos; número brasileiro sem DDI ganha o 55. */
export function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return digits;
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

export function WaitlistPanel({
  entries,
  slug,
  restaurantName,
  freeTables,
  busy,
  now,
  command,
  onSeated,
  t,
}: {
  entries: WaitlistEntry[];
  slug: string;
  restaurantName: string;
  freeTables: { id: string; label: string }[];
  busy: boolean;
  now: number;
  command: Command;
  onSeated: (tableId: string) => void;
  t: Translate;
}) {
  const [adding, setAdding] = useState(false);
  const [seating, setSeating] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const waiting = entries.filter((e) => e.status === "aguardando" || e.status === "chamado");
  const done = entries.filter((e) => e.status === "sentado" || e.status === "desistiu").toReversed();
  const minutes = (iso: string) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  const copy = async (entry: WaitlistEntry) => {
    try {
      await navigator.clipboard.writeText(waitlistLink(slug, entry.public_token));
      setCopied(entry.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setQrFor(entry.id);
    }
  };
  return (
    <section className="waitlist-panel" aria-label={t("Lista de espera")}>
      <div className="waitlist-panel-head">
        <p>
          <b>{t("{n} na espera", { n: waiting.length })}</b>
          <small>
            {t("{n} pessoas aguardando", { n: waiting.reduce((sum, e) => sum + e.party_size, 0) })}
          </small>
        </p>
        <button className="waitlist-add-button" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {adding ? <X size={16} /> : <UserPlus size={16} />}
          {adding ? t("Fechar") : t("Adicionar grupo")}
        </button>
      </div>
      {adding && (
        <form
          className="waitlist-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void command({
              action: "waitlist_add",
              data: {
                name: String(f.get("name") || ""),
                party_size: Number(f.get("party_size") || 1),
                phone: String(f.get("phone") || "") || undefined,
                note: String(f.get("note") || "") || undefined,
              },
            }).then((ok) => {
              if (ok) {
                form.reset();
                setAdding(false);
              }
            });
          }}
        >
          <label>
            {t("Nome")}
            <input name="name" required maxLength={60} autoComplete="off" autoFocus />
          </label>
          <label>
            {t("Pessoas")}
            <input name="party_size" type="number" min={1} max={50} defaultValue={2} required />
          </label>
          <label>
            {t("Telefone (opcional)")}
            <input name="phone" type="tel" maxLength={20} inputMode="tel" placeholder="(11) 99999-0000" />
          </label>
          <label>
            {t("Observação (opcional)")}
            <input name="note" maxLength={120} placeholder={t("Ex.: cadeirinha, área externa")} />
          </label>
          <button disabled={busy} className="waitlist-primary">
            {t("Entrar na fila")}
          </button>
        </form>
      )}
      {!waiting.length && !adding && (
        <div className="waitlist-empty">
          <Users size={32} />
          <p>{t("Ninguém na espera agora.")}</p>
        </div>
      )}
      <ol className="waitlist-list">
        {waiting.map((entry, index) => {
          const link = waitlistLink(slug, entry.public_token);
          const message = t("Olá, {name}! Sua mesa no {restaurant} está pronta. Procure a recepção. Senha {number}.", {
            name: entry.name.split(" ")[0],
            restaurant: restaurantName,
            number: entry.number,
          });
          return (
            <li key={entry.id} className={`waitlist-entry ${entry.status === "chamado" ? "called" : ""}`}>
              <div className="waitlist-entry-main">
                <strong className="waitlist-entry-number" aria-label={t("Senha {n}", { n: entry.number })}>
                  {entry.number}
                </strong>
                <div>
                  <b>{entry.name}</b>
                  <small>
                    {entry.party_size === 1 ? t("1 pessoa") : t("{n} pessoas", { n: entry.party_size })} •{" "}
                    {entry.status === "chamado" && entry.called_at
                      ? t("chamado há {n} min", { n: minutes(entry.called_at) })
                      : t("esperando há {n} min", { n: minutes(entry.created_at) })}
                    {index === 0 && entry.status === "aguardando" && ` • ${t("próximo")}`}
                  </small>
                  {entry.note && <small className="waitlist-entry-note">“{entry.note}”</small>}
                </div>
                {entry.status === "chamado" && (
                  <span className="waitlist-called-badge">
                    <BellRing size={13} /> {t("Chamado")}
                  </span>
                )}
              </div>
              <div className="waitlist-entry-actions">
                {entry.status === "aguardando" ? (
                  <button disabled={busy} className="waitlist-primary" onClick={() => void command({ action: "waitlist_status", entry_id: entry.id, status: "chamado" })}>
                    <BellRing size={15} /> {t("Chamar")}
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => void command({ action: "waitlist_status", entry_id: entry.id, status: "aguardando" })}>
                    <Undo2 size={15} /> {t("Voltar para a fila")}
                  </button>
                )}
                <button disabled={busy} onClick={() => setSeating((v) => (v === entry.id ? null : entry.id))} aria-expanded={seating === entry.id}>
                  <Check size={15} /> {t("Sentar")}
                </button>
                <button
                  disabled={busy}
                  className="waitlist-danger"
                  onClick={() => void command({ action: "waitlist_status", entry_id: entry.id, status: "desistiu" })}
                >
                  {t("Desistiu")}
                </button>
              </div>
              {seating === entry.id && (
                <div className="waitlist-seat">
                  <small>{t("Escolha uma mesa livre. A comanda abre na hora e o PIN aparece em seguida.")}</small>
                  <div className="flex flex-wrap gap-2">
                    {freeTables.map((table) => (
                      <button
                        key={table.id}
                        disabled={busy}
                        aria-label={t("Sentar na mesa {label}", { label: table.label })}
                        onClick={() =>
                          void command({ action: "waitlist_seat", entry_id: entry.id, table_id: table.id }).then((ok) => {
                            if (ok) {
                              setSeating(null);
                              onSeated(table.id);
                            }
                          })
                        }
                      >
                        {t("Mesa {label}", { label: table.label })}
                      </button>
                    ))}
                    <button
                      disabled={busy}
                      className="waitlist-ghost"
                      onClick={() => void command({ action: "waitlist_seat", entry_id: entry.id, table_id: null }).then((ok) => ok && setSeating(null))}
                    >
                      {t("Sentar sem abrir mesa")}
                    </button>
                  </div>
                  {!freeTables.length && <small>{t("Nenhuma mesa livre agora.")}</small>}
                </div>
              )}
              <div className="waitlist-share">
                <button onClick={() => void copy(entry)}>
                  <Copy size={14} /> {copied === entry.id ? t("Link copiado") : t("Copiar link")}
                </button>
                <button onClick={() => setQrFor((v) => (v === entry.id ? null : entry.id))} aria-expanded={qrFor === entry.id}>
                  <QrCode size={14} /> {t("QR do cliente")}
                </button>
                {entry.phone && (
                  <a href={`https://wa.me/${whatsappNumber(entry.phone)}?text=${encodeURIComponent(`${message}\n${link}`)}`} target="_blank" rel="noreferrer">
                    <MessageCircle size={14} /> {t("Avisar no WhatsApp")}
                  </a>
                )}
              </div>
              {qrFor === entry.id && <WaitlistQr link={link} t={t} />}
            </li>
          );
        })}
      </ol>
      {done.length > 0 && (
        <div className="waitlist-done">
          <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            {showDone ? t("Ocultar atendidos hoje") : t("Atendidos hoje ({n})", { n: done.length })}
          </button>
          {showDone && (
            <ul>
              {done.map((entry) => (
                <li key={entry.id}>
                  <b>{entry.number}</b> {entry.name} • {entry.party_size}{" "}
                  <small>{entry.status === "sentado" ? t("Sentado") : t("Desistiu")}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function WaitlistQr({ link, t }: { link: string; t: Translate }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(link, { margin: 1, width: 220 }).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [link]);
  return (
    <div className="waitlist-qr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={t("QR para acompanhar a fila")} width={220} height={220} /> : <span role="status">…</span>}
      <small>{t("O cliente escaneia para acompanhar a posição na fila.")}</small>
    </div>
  );
}
