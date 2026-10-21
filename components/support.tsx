"use client";
// Botão Ajuda (spec-fase2.md, seção 2) e faixa da assinatura (seção 13),
// usados pelo painel do gestor, da revenda, do salão, da cozinha e do bar.
import { useState } from "react";
import { LifeBuoy, X } from "lucide-react";
import { STATUS_LABELS, type Access } from "@/lib/features";

export type Support = {
  brand_name: string;
  support_whatsapp?: string | null;
  support_email?: string | null;
  support_hours?: string | null;
};

const FAQ = [
  { q: "Como abrir uma mesa?", a: "No Salão, toque na mesa e em Abrir mesa. O PIN de 4 dígitos aparece na tela; passe ao cliente." },
  { q: "O cliente diz que o PIN não funciona", a: "Confira se a comanda ainda está aberta e se o código é o da mesa certa. Gerar novo PIN resolve se o código vazou." },
  { q: "Um item acabou", a: "Na Cozinha ou no Bar, em Esgotados, ligue a chave do item. Ele some do cardápio na hora e volta quando você desligar." },
  { q: "Não consigo fechar a comanda", a: "A comanda só fecha com o saldo quitado. Registre os pagamentos (por pessoa ou da mesa) e feche em seguida." },
];

export function HelpButton({ support, context, className }: { support: Support; context: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const digits = support.support_whatsapp?.replace(/\D/g, "");
  const message = encodeURIComponent(`Olá! Preciso de ajuda com o ${support.brand_name} (${context}).`);
  return (
    <>
      <button className={className ?? "flex items-center gap-2 text-left"} onClick={() => setOpen(true)} aria-label="Ajuda">
        <LifeBuoy size={18} />
        Ajuda
      </button>
      {open && (
        <div className="help-backdrop" role="dialog" aria-modal="true" aria-label="Ajuda">
          <section className="help-sheet">
            <header className="flex items-center justify-between">
              <h2 className="font-heading text-2xl">Ajuda • {support.brand_name}</h2>
              <button aria-label="Fechar ajuda" onClick={() => setOpen(false)}><X /></button>
            </header>
            <div className="help-contact">
              {digits ? (
                <a className="help-whatsapp" href={`https://wa.me/${digits}?text=${message}`} target="_blank" rel="noopener noreferrer">
                  Falar no WhatsApp
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">A revenda ainda não cadastrou um WhatsApp de suporte.</p>
              )}
              {support.support_email && <p>E-mail: <a className="underline" href={`mailto:${support.support_email}`}>{support.support_email}</a></p>}
              {support.support_hours && <p className="text-sm text-muted-foreground">Atendimento: {support.support_hours}</p>}
            </div>
            <h3 className="mt-5 font-semibold">Perguntas frequentes</h3>
            <div className="help-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
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
  if (!access || access.status === "ativa") return null;
  if (access.status === "teste")
    return (
      <p className="access-banner trial" role="status">
        Período de teste{access.trial_ends_at ? ` até ${new Date(access.trial_ends_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}. Plano {access.plan ?? ""}.
      </p>
    );
  if (access.status === "atrasada")
    return (
      <p className="access-banner late" role="alert">
        Assinatura atrasada{access.period_end ? ` desde ${new Date(access.period_end).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}. Tudo continua funcionando por {access.grace_days ?? 5} dias; depois o painel fica só para leitura. Fale com a revenda{support?.support_whatsapp ? ` pelo WhatsApp ${support.support_whatsapp}` : ""}.
      </p>
    );
  return (
    <p className="access-banner blocked" role="alert">
      Assinatura {STATUS_LABELS[access.status].toLowerCase()}: o cardápio não aceita pedidos e o painel está em modo leitura. Nada foi apagado. Fale com a revenda{support?.support_whatsapp ? ` pelo WhatsApp ${support.support_whatsapp}` : ""}{support?.support_email ? ` ou por ${support.support_email}` : ""}.
    </p>
  );
}
