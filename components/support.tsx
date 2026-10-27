"use client";
// Botão Ajuda (spec-fase2.md, seção 2) e faixa da assinatura (seção 13),
// usados pelo painel do gestor, da revenda, do salão, da cozinha e do bar.
import { useState } from "react";
import { LifeBuoy, X } from "lucide-react";
import { STATUS_LABELS, type Access } from "@/lib/features";
import { LOCALE_TAGS, msg } from "@/lib/i18n";
import { useI18n } from "@/components/i18n";

export type Support = {
  brand_name: string;
  support_whatsapp?: string | null;
  support_email?: string | null;
  support_hours?: string | null;
};

const FAQ = [
  { q: msg("Como abrir uma mesa?"), a: msg("No Salão, toque na mesa e em Abrir mesa. O PIN de 4 dígitos aparece na tela; passe ao cliente.") },
  { q: msg("O cliente diz que o PIN não funciona"), a: msg("Confira se a comanda ainda está aberta e se o código é o da mesa certa. Gerar novo PIN resolve se o código vazou.") },
  { q: msg("Um item acabou"), a: msg("Na Cozinha ou no Bar, em Esgotados, ligue a chave do item. Ele some do cardápio na hora e volta quando você desligar.") },
  { q: msg("Não consigo fechar a comanda"), a: msg("A comanda só fecha com o saldo quitado. Registre os pagamentos (por pessoa ou da mesa) e feche em seguida.") },
  { q: msg("Como funciona a lista de espera?"), a: msg("No Salão, abra Espera e adicione o grupo. Cada grupo ganha um número do dia; chame, sente numa mesa livre (a comanda abre na hora) ou marque desistência. O cliente acompanha pelo link ou QR.") },
  { q: msg("Como pausar os pedidos?"), a: msg("Toque em Pausar pedidos no topo do Salão, da Cozinha ou do Bar. O cardápio continua aberto, mas ninguém consegue enviar pedido até alguém retomar.") },
];

export function HelpButton({ support, context, className }: { support: Support; context: string; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const digits = support.support_whatsapp?.replace(/\D/g, "");
  const message = encodeURIComponent(`Olá! Preciso de ajuda com o ${support.brand_name} (${context}).`);
  return (
    <>
      <button className={className ?? "flex items-center gap-2 text-left"} onClick={() => setOpen(true)} aria-label={t("Ajuda")}>
        <LifeBuoy size={18} />{t("Ajuda")}</button>
      {open && (
        <div className="help-backdrop" role="dialog" aria-modal="true" aria-label={t("Ajuda")}>
          <section className="help-sheet">
            <header className="flex items-center justify-between">
              <h2 className="font-heading text-2xl">{t("Ajuda • {brand}", { brand: support.brand_name })}</h2>
              <button aria-label={t("Fechar ajuda")} onClick={() => setOpen(false)}><X /></button>
            </header>
            <div className="help-contact">
              {digits ? (
                <a className="help-whatsapp" href={`https://wa.me/${digits}?text=${message}`} target="_blank" rel="noopener noreferrer">{t("Falar no WhatsApp")}</a>
              ) : (
                <p className="text-sm text-muted-foreground">{t("A revenda ainda não cadastrou um WhatsApp de suporte.")}</p>
              )}
              {support.support_email && <p>{t("E-mail:")}{" "}<a className="underline" href={`mailto:${support.support_email}`}>{support.support_email}</a></p>}
              {support.support_hours && <p className="text-sm text-muted-foreground">{t("Atendimento: {hours}", { hours: support.support_hours })}</p>}
            </div>
            <h3 className="mt-5 font-semibold">{t("Perguntas frequentes")}</h3>
            <div className="help-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{t(f.q)}</summary>
                  <p>{t(f.a)}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

/** Faixa de aviso da assinatura: atrasada avisa; suspensa trava. */
export function AccessBanner({ access, support }: { access: Access | null | undefined; support?: Support }) {
  const { locale, t } = useI18n();
  if (!access || access.status === "ativa") return null;
  const date = (iso: string) => new Date(iso).toLocaleDateString(LOCALE_TAGS[locale], { timeZone: "America/Sao_Paulo" });
  const contact = [
    support?.support_whatsapp ? t("pelo WhatsApp {phone}", { phone: support.support_whatsapp }) : "",
    support?.support_email ? t("ou por {email}", { email: support.support_email }) : "",
  ].filter(Boolean).join(" ");
  if (access.status === "teste")
    return (
      <p className="access-banner trial" role="status">
        {access.trial_ends_at
          ? t("Período de teste até {date}. Plano {plan}.", { date: date(access.trial_ends_at), plan: access.plan ?? "" })
          : t("Período de teste. Plano {plan}.", { plan: access.plan ?? "" })}
      </p>
    );
  if (access.status === "atrasada")
    return (
      <p className="access-banner late" role="alert">
        {access.period_end ? t("Assinatura atrasada desde {date}.", { date: date(access.period_end) }) : t("Assinatura atrasada.")}{" "}
        {t("Tudo continua funcionando por {n} dias; depois o painel fica só para leitura. Fale com a revenda", { n: access.grace_days ?? 5 })}
        {contact && ` ${contact}`}.
      </p>
    );
  return (
    <p className="access-banner blocked" role="alert">
      {t("Assinatura {status}: o cardápio não aceita pedidos e o painel está em modo leitura. Nada foi apagado. Fale com a revenda", { status: t(STATUS_LABELS[access.status]).toLowerCase() })}
      {contact && ` ${contact}`}.
    </p>
  );
}
