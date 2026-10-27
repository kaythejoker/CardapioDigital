// Idiomas da interface e do cardápio (spec-fase3.md, seção 3). A chave é a
// própria frase em português: o que não estiver no dicionário aparece em
// português. `tests/i18n.test.ts` confere que toda frase usada com t() tem
// inglês e espanhol.
import { EN, ES, PATTERNS } from "@/lib/i18n-dict";

export const LOCALES = ["pt", "en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_LABELS: Record<Locale, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
};
export const LOCALE_TAGS: Record<Locale, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
};
const DICTS: Record<Exclude<Locale, "pt">, Record<string, string>> = { en: EN, es: ES };

export type Vars = Record<string, string | number>;
export type Translate = (text: string, vars?: Vars) => string;

/** Mensagem do banco com trechos variáveis ("X não está disponível agora"). */
function fromPattern(locale: Exclude<Locale, "pt">, text: string) {
  for (const [pattern, en, es] of PATTERNS) {
    if (pattern.test(text)) return text.replace(pattern, locale === "en" ? en : es);
  }
  return text;
}

/** Frase no idioma, com {variáveis} preenchidas. */
export function translate(locale: Locale, text: string, vars?: Vars) {
  const base = locale === "pt" ? text : (DICTS[locale][text] ?? fromPattern(locale, text));
  return vars
    ? base.replace(/\{(\w+)\}/g, (match, key: string) =>
        key in vars ? String(vars[key]) : match,
      )
    : base;
}

/**
 * Marca uma frase que será traduzida depois, com t(valor), sem traduzir agora
 * (rótulos em constantes, mensagens guardadas em estado). O teste de cobertura
 * procura as chamadas de t e msg com texto fixo.
 */
export const msg = <T extends string>(text: T) => text;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Idioma do navegador (pt-BR, en-GB, es-AR...) ou português. */
export function detectLocale(languages: readonly string[] | undefined): Locale {
  for (const tag of languages ?? []) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return "pt";
}

/** Traduções salvas no cardápio: {"en": {"name": "..."}, "es": {...}}. */
export type Translations = Partial<Record<"en" | "es", Partial<Record<string, string>>>>;

/** Campo do cardápio no idioma; vazio cai no português. */
export function localized(
  locale: Locale,
  value: string,
  translations: Translations | null | undefined,
  field?: string,
): string;
export function localized(
  locale: Locale,
  value: string | null,
  translations: Translations | null | undefined,
  field?: string,
): string | null;
export function localized(
  locale: Locale,
  value: string | null,
  translations: Translations | null | undefined,
  field = "name",
) {
  if (locale === "pt") return value;
  return translations?.[locale]?.[field]?.trim() || value;
}

/** Hora e data no formato do idioma, sempre no fuso de São Paulo. */
export function formatTime(locale: Locale, iso: string | Date) {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}
