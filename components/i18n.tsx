"use client";
// Idioma escolhido no aparelho (spec-fase3.md, seção 3). Sem escolha, segue o
// navegador. O servidor sempre renderiza em português; o navegador troca logo
// depois de hidratar, sem erro de hidratação.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Languages } from "lucide-react";
import {
  detectLocale,
  isLocale,
  LOCALE_LABELS,
  LOCALE_TAGS,
  LOCALES,
  translate,
  type Locale,
  type Translate,
} from "@/lib/i18n";

const KEY = "comanda_idioma";
const listeners = new Set<() => void>();

function read(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLocale(saved)) return saved;
  } catch {}
  return detectLocale(navigator.languages);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(KEY, locale);
  } catch {}
  listeners.forEach((l) => l());
}

/**
 * `enabled = false` prende em português (cardápio de restaurante sem o módulo
 * de idiomas).
 */
export function useI18n(enabled = true): { locale: Locale; t: Translate } {
  const chosen = useSyncExternalStore(subscribe, read, () => "pt" as Locale);
  const locale = enabled ? chosen : "pt";
  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[locale];
  }, [locale]);
  const t = useCallback<Translate>((text, vars) => translate(locale, text, vars), [locale]);
  return { locale, t };
}

/** Frase traduzida dentro de componente do servidor: <T>Sua operação</T>. */
export function T({ children, vars }: { children: string; vars?: Record<string, string | number> }) {
  const { t } = useI18n();
  return <>{t(children, vars)}</>;
}

export function LanguageSwitcher({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { locale, t } = useI18n();
  return (
    <label className={`language-switcher ${className}`}>
      <Languages size={16} aria-hidden />
      <span className="sr-only">{t("Idioma")}</span>
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t("Idioma")}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {compact ? l.toUpperCase() : LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
