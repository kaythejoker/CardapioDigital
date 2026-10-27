"use client";
// Página do cliente na lista de espera (spec-fase3.md, seção 1): número, quantos
// grupos estão na frente e o aviso de mesa pronta. Atualiza a cada 10 s.
import { useEffect, useState, type CSSProperties } from "react";
import { BellRing, Check, Users } from "lucide-react";
import { brandForeground } from "@/lib/menu-types";
import { restaurantBrand } from "@/lib/restaurant-brand";
import { formatTime } from "@/lib/i18n";
import { LanguageSwitcher, useI18n } from "@/components/i18n";
import type { WaitlistTicket as Ticket } from "@/lib/waitlist";

export function WaitlistTicket({ slug, token, initial }: { slug: string; token: string; initial: Ticket | null }) {
  const [ticket, setTicket] = useState<Ticket | null>(initial);
  const [expired, setExpired] = useState(!initial);
  const { locale, t } = useI18n(ticket?.restaurant.languages !== false);
  const done = ticket?.status === "sentado" || ticket?.status === "desistiu";
  useEffect(() => {
    if (done || expired) return;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/espera/${slug}/${token}`, { cache: "no-store" });
        if (response.status === 404) setExpired(true);
        else if (response.ok) setTicket(await response.json());
      } catch {
        /* sem conexão: tenta de novo no próximo ciclo */
      }
    };
    const timer = setInterval(load, 10_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [slug, token, done, expired]);
  // Chamado: o celular vibra uma vez, quando o navegador permite.
  const called = ticket?.status === "chamado";
  useEffect(() => {
    if (called) navigator.vibrate?.([200, 100, 200]);
  }, [called]);

  if (!ticket || expired)
    return (
      <main className="waitlist-page">
        <section className="waitlist-card">
          <h1 className="font-heading text-3xl">{t("Lista de espera")}</h1>
          <p>{t("Este link da lista de espera expirou. Fale com a recepção do restaurante.")}</p>
        </section>
      </main>
    );
  const brand = restaurantBrand({
    primary_color: ticket.restaurant.primary_color,
    resellers: ticket.restaurant.brand,
  });
  const style = {
    "--brand": brand.primary_color,
    "--brand-foreground": brandForeground(brand.primary_color),
    "--menu-background": ticket.restaurant.background_color || "#faf7f2",
  } as CSSProperties;
  return (
    <main className="waitlist-page brand-scope" style={style}>
      <header className="waitlist-header">
        <span>{ticket.restaurant.name}</span>
        {ticket.restaurant.languages && <LanguageSwitcher compact />}
      </header>
      <section className={`waitlist-card ${called ? "called" : ""}`} aria-live="polite">
        <p className="waitlist-hello">{t("Olá, {name}!", { name: ticket.name })}</p>
        <p className="waitlist-label">{t("Seu número")}</p>
        <strong className="waitlist-number">{ticket.number}</strong>
        <p className="waitlist-party">
          <Users size={16} /> {ticket.party_size === 1 ? t("1 pessoa") : t("{n} pessoas", { n: ticket.party_size })}
        </p>
        {ticket.status === "aguardando" && (
          <div className="waitlist-status">
            <b>
              {ticket.ahead === 0
                ? t("Você é o próximo!")
                : ticket.ahead === 1
                  ? t("1 grupo na sua frente")
                  : t("{n} grupos na sua frente", { n: ticket.ahead })}
            </b>
            <small>{t("Na fila desde {time}. Esta página se atualiza sozinha.", { time: formatTime(locale, ticket.created_at) })}</small>
          </div>
        )}
        {called && (
          <div className="waitlist-status">
            <BellRing size={28} />
            <b>{t("Sua mesa está pronta!")}</b>
            <small>{t("Procure a recepção do restaurante.")}</small>
          </div>
        )}
        {ticket.status === "sentado" && (
          <div className="waitlist-status">
            <Check size={28} />
            <b>{t("Bom apetite!")}</b>
            <small>{t("Você já foi acomodado. Escaneie o QR da mesa para ver o cardápio.")}</small>
          </div>
        )}
        {ticket.status === "desistiu" && (
          <div className="waitlist-status">
            <b>{t("Você saiu da lista de espera.")}</b>
            <small>{t("Se foi engano, fale com a recepção.")}</small>
          </div>
        )}
      </section>
      <footer className="waitlist-footer">{t("Por {brand}", { brand: brand.brand_name })}</footer>
    </main>
  );
}
