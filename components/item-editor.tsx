"use client";
import { useState } from "react";
import { Languages, Plus, X } from "lucide-react";
import { type ItemInput } from "@/lib/manage-schema";
import { type MenuItem } from "@/lib/menu-types";
import { type Translations } from "@/lib/i18n";
import { useI18n } from "@/components/i18n";
import {
  actionClass,
  fieldClass,
  ImageUpload,
  jsonRequest,
  panelClass,
} from "@/components/admin-ui";

const FOREIGN = [
  ["en", "Inglês"],
  ["es", "Espanhol"],
] as const;

/** "11:00:00" do banco vira "11:00" para o campo de hora. */
export const hhmm = (time: string | null | undefined) => (time ? time.slice(0, 5) : null);

/** Nome (e descrição) em inglês e espanhol; vazio usa o português. */
export function TranslationFields({
  value,
  onChange,
  fields,
  compact = false,
}: {
  value: Translations;
  onChange: (next: Translations) => void;
  fields: readonly ("name" | "description")[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const update = (lang: "en" | "es", field: string, text: string) =>
    onChange({ ...value, [lang]: { ...value[lang], [field]: text } });
  return (
    <div className={compact ? "translation-fields compact" : "translation-fields"}>
      {FOREIGN.map(([lang, label]) =>
        fields.map((field) => {
          const name = field === "name" ? t("Nome em {lang}", { lang: t(label).toLowerCase() }) : t("Descrição em {lang}", { lang: t(label).toLowerCase() });
          return (
            <label key={`${lang}-${field}`} className={field === "description" ? "translation-wide" : ""}>
              <span>
                <b className="translation-lang">{lang.toUpperCase()}</b> {name}
              </span>
              {field === "description" ? (
                <textarea
                  value={value[lang]?.[field] ?? ""}
                  maxLength={1000}
                  aria-label={name}
                  onChange={(e) => update(lang, field, e.target.value)}
                  className={fieldClass}
                />
              ) : (
                <input
                  value={value[lang]?.[field] ?? ""}
                  maxLength={100}
                  aria-label={name}
                  onChange={(e) => update(lang, field, e.target.value)}
                  className={fieldClass}
                />
              )}
            </label>
          );
        }),
      )}
    </div>
  );
}

/** Bloqueio com motivo e janela de horário (spec-fase3.md, seção 2). */
export function AvailabilityFields({
  value,
  onChange,
  subject,
}: {
  value: { blocked: boolean; blocked_reason: string | null; available_from: string | null; available_until: string | null };
  onChange: (patch: Partial<{ blocked: boolean; blocked_reason: string | null; available_from: string | null; available_until: string | null }>) => void;
  subject: "item" | "categoria";
}) {
  const { t } = useI18n();
  const hours = value.available_from !== null || value.available_until !== null;
  return (
    <div className="availability-fields">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.blocked}
          onChange={(e) => onChange({ blocked: e.target.checked, blocked_reason: e.target.checked ? value.blocked_reason : null })}
        />
        {subject === "item" ? t("Bloquear este prato") : t("Bloquear esta categoria")}
      </label>
      {value.blocked && (
        <label className="block">
          {t("Motivo (opcional, o cliente vê)")}
          <input
            value={value.blocked_reason ?? ""}
            maxLength={120}
            placeholder={t("Ex.: volta amanhã")}
            onChange={(e) => onChange({ blocked_reason: e.target.value || null })}
            className={fieldClass}
          />
        </label>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={hours}
          onChange={(e) =>
            onChange(e.target.checked ? { available_from: "11:00", available_until: "15:00" } : { available_from: null, available_until: null })
          }
        />
        {t("Só em alguns horários")}
      </label>
      {hours && (
        <div className="flex flex-wrap items-end gap-4">
          <label>
            {t("De")}
            <input
              type="time"
              required
              value={value.available_from ?? ""}
              onChange={(e) => onChange({ available_from: e.target.value || null })}
              className={fieldClass}
            />
          </label>
          <label>
            {t("Até")}
            <input
              type="time"
              required
              value={value.available_until ?? ""}
              onChange={(e) => onChange({ available_until: e.target.value || null })}
              className={fieldClass}
            />
          </label>
          <p className="pb-3 text-sm text-muted-foreground">
            {t("Horário de Brasília. Pode passar da meia-noite (ex.: 22:00 até 02:00).")}
          </p>
        </div>
      )}
    </div>
  );
}

export function ItemEditor({
  restaurantId,
  categories,
  item,
  onClose,
  onSaved,
  categoryStation,
  languages = true,
  blocks = true,
}: {
  restaurantId: string;
  categories: { id: string; name: string }[];
  item:
    | (MenuItem & {
        active: boolean;
        position: number;
        stock_enabled?: boolean;
        stock_quantity?: number | null;
        low_stock_threshold?: number;
        station?: "cozinha" | "bar" | null;
      })
    | null;
  categoryStation?: (categoryId: string) => "cozinha" | "bar";
  onClose: () => void;
  onSaved: () => void;
  /** Módulo de idiomas: mostra os campos de tradução. */
  languages?: boolean;
  /** Módulo de bloqueios: mostra bloqueio e horário. */
  blocks?: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState<ItemInput>(() =>
    item
      ? {
          category_id: item.category_id,
          name: item.name,
          description: item.description || "",
          price_cents: item.price_cents,
          photo_url: item.photo_url,
          prep_minutes: item.prep_minutes,
          active: item.active,
          featured: item.featured,
          position: item.position,
          stock_enabled: item.stock_enabled ?? false,
          stock_quantity: item.stock_quantity ?? null,
          low_stock_threshold: item.low_stock_threshold ?? 5,
          station: item.station ?? null,
          translations: item.translations ?? {},
          blocked: item.blocked ?? false,
          blocked_reason: item.blocked_reason ?? null,
          available_from: hhmm(item.available_from),
          available_until: hhmm(item.available_until),
          groups: item.modifier_groups
            .toSorted((a, b) => a.position - b.position)
            .map((g) => ({
              name: g.name,
              translations: g.translations ?? {},
              required: g.required,
              min_select: g.min_select,
              max_select: g.max_select,
              position: g.position,
              modifiers: g.modifiers
                .toSorted((a, b) => a.position - b.position)
                .map((m) => ({
                  name: m.name,
                  price_cents: m.price_cents,
                  position: m.position,
                  translations: m.translations ?? {},
                })),
            })),
        }
      : {
          category_id: categories[0]?.id ?? "",
          name: "",
          description: "",
          price_cents: 0,
          photo_url: null,
          prep_minutes: 10,
          active: true,
          featured: false,
          position: 0,
          stock_enabled: false,
          stock_quantity: null,
          low_stock_threshold: 5,
          station: null,
          translations: {},
          blocked: false,
          blocked_reason: null,
          available_from: null,
          available_until: null,
          groups: [],
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof ItemInput>(key: K, next: ItemInput[K]) =>
    setValue((v) => ({ ...v, [key]: next }));
  const group = (index: number, patch: Partial<ItemInput["groups"][number]>) =>
    setValue((v) => ({
      ...v,
      groups: v.groups.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));
  return (
    <section className={panelClass}>
      <header className="mb-6 flex justify-between">
        <h3 className="font-heading text-3xl">
          {item ? t("Editar item") : t("Novo item")}
        </h3>
        <button onClick={onClose} aria-label={t("Fechar editor")}>
          <X />
        </button>
      </header>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await jsonRequest(`/api/manage/${restaurantId}`, {
              action: "item",
              ...(item ? { id: item.id } : {}),
              data: {
                ...value,
                groups: value.groups.map((g, i) => ({
                  ...g,
                  position: i,
                  modifiers: g.modifiers.map((m, j) => ({ ...m, position: j })),
                })),
              },
            });
            onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Tente novamente");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-5 md:grid-cols-2">
          <label>
            {t("Nome")}
            <input
              value={value.name}
              maxLength={100}
              required
              onChange={(e) => set("name", e.target.value)}
              className={fieldClass}
            />
          </label>
          <label>
            {t("Categoria")}
            <select
              value={value.category_id}
              onChange={(e) => set("category_id", e.target.value)}
              className={fieldClass}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          {t("Descrição")}
          <textarea
            value={value.description}
            maxLength={1000}
            onChange={(e) => set("description", e.target.value)}
            className={fieldClass}
          />
        </label>
        {languages && (
          <details className="translation-box" open={!!item && Object.keys(item.translations ?? {}).length > 0}>
            <summary>
              <Languages size={16} /> {t("Traduções (inglês e espanhol)")}
            </summary>
            <p className="mb-3 text-sm text-muted-foreground">
              {t("Campo vazio mostra o texto em português.")}
            </p>
            <TranslationFields
              value={value.translations ?? {}}
              fields={["name", "description"]}
              onChange={(next) => set("translations", next)}
            />
          </details>
        )}
        <div className="grid gap-5 md:grid-cols-2">
          <label>
            {t("Preço (R$)")}
            <input
              type="number"
              min={0}
              max={10000}
              step="0.01"
              required
              value={value.price_cents / 100}
              onChange={(e) =>
                set("price_cents", Math.round(Number(e.target.value) * 100))
              }
              className={fieldClass}
            />
          </label>
          <label>
            {t("Preparo (minutos)")}
            <input
              type="number"
              min={1}
              max={240}
              required
              value={value.prep_minutes}
              onChange={(e) => set("prep_minutes", Number(e.target.value))}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="block md:w-1/2">
          {t("Setor de preparo")}
          <select
            value={value.station ?? ""}
            onChange={(e) =>
              set("station", (e.target.value || null) as "cozinha" | "bar" | null)
            }
            className={fieldClass}
          >
            <option value="">
              {t("Herdar da categoria")}
              {categoryStation ? ` (${categoryStation(value.category_id) === "bar" ? t("Bar") : t("Cozinha")})` : ""}
            </option>
            <option value="cozinha">{t("Cozinha")}</option>
            <option value="bar">{t("Bar")}</option>
          </select>
        </label>
        <ImageUpload
          kind="restaurant"
          id={restaurantId}
          value={value.photo_url || null}
          onChange={(url) => set("photo_url", url)}
          label={t("Foto do item")}
        />
        <div className="flex gap-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            {t("Ativo")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.featured}
              onChange={(e) => set("featured", e.target.checked)}
            />
            {t("Destaque da casa")}
          </label>
        </div>
        {blocks && (
          <fieldset className="rounded-2xl border p-4">
            <legend className="px-2 font-semibold">{t("Disponibilidade")}</legend>
            <p className="mb-3 text-sm text-muted-foreground">
              {t("Prato bloqueado ou fora do horário aparece no cardápio, mas não pode ser pedido.")}
            </p>
            <AvailabilityFields
              subject="item"
              value={{
                blocked: value.blocked ?? false,
                blocked_reason: value.blocked_reason ?? null,
                available_from: value.available_from ?? null,
                available_until: value.available_until ?? null,
              }}
              onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
            />
          </fieldset>
        )}
        <fieldset className="rounded-2xl border p-4">
          <legend className="px-2 font-semibold">{t("Estoque")}</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.stock_enabled}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  stock_enabled: e.target.checked,
                  stock_quantity: e.target.checked ? (v.stock_quantity ?? 0) : null,
                }))
              }
            />
            {t("Controlar estoque")}
          </label>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Cada pedido baixa a quantidade; ao chegar a zero o item some do cardápio até a reposição. Cancelamentos devolvem ao estoque.")}
          </p>
          {value.stock_enabled && (
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <label>
                {t("Quantidade atual")}
                <input
                  type="number"
                  min={0}
                  max={100000}
                  required
                  aria-label={t("Quantidade em estoque")}
                  value={value.stock_quantity ?? 0}
                  onChange={(e) => set("stock_quantity", Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
              <label>
                {t("Avisar quando restar")}
                <input
                  type="number"
                  min={0}
                  max={100000}
                  aria-label={t("Limite de alerta de estoque")}
                  value={value.low_stock_threshold}
                  onChange={(e) =>
                    set("low_stock_threshold", Number(e.target.value))
                  }
                  className={fieldClass}
                />
              </label>
            </div>
          )}
        </fieldset>
        <div>
          <h4 className="mb-4 font-heading text-2xl">{t("Grupos de adicionais")}</h4>
          <div className="space-y-4">
            {value.groups.map((g, i) => (
              <fieldset key={i} className="rounded-2xl border p-4">
                <legend className="px-2 font-semibold">{t("Grupo {n}", { n: i + 1 })}</legend>
                <div className="flex items-end gap-3">
                  <label className="flex-1">
                    {t("Nome do grupo")}
                    <input
                      value={g.name}
                      maxLength={100}
                      required
                      onChange={(e) => group(i, { name: e.target.value })}
                      className={fieldClass}
                    />
                  </label>
                  <button
                    type="button"
                    className="mb-3 text-destructive"
                    aria-label={t("Remover grupo {n}", { n: i + 1 })}
                    onClick={() =>
                      set(
                        "groups",
                        value.groups.filter((_, j) => i !== j),
                      )
                    }
                  >
                    <X />
                  </button>
                </div>
                {languages && (
                  <TranslationFields
                    compact
                    value={g.translations ?? {}}
                    fields={["name"]}
                    onChange={(next) => group(i, { translations: next })}
                  />
                )}
                <div className="my-4 grid grid-cols-3 items-end gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={g.required}
                      onChange={(e) =>
                        group(i, {
                          required: e.target.checked,
                          min_select: e.target.checked
                            ? Math.max(1, g.min_select)
                            : 0,
                        })
                      }
                    />
                    {t("Obrigatório")}
                  </label>
                  <label>
                    {t("Mínimo")}
                    <input
                      type="number"
                      min={g.required ? 1 : 0}
                      max={50}
                      value={g.min_select}
                      onChange={(e) =>
                        group(i, { min_select: Number(e.target.value) })
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label>
                    {t("Máximo")}
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={g.max_select}
                      onChange={(e) =>
                        group(i, { max_select: Number(e.target.value) })
                      }
                      className={fieldClass}
                    />
                  </label>
                </div>
                {g.modifiers.map((m, j) => (
                  <div key={j} className="mb-3">
                    <div className="flex items-end gap-3">
                      <label className="flex-1">
                        {t("Opção {n}", { n: j + 1 })}
                        <input
                          value={m.name}
                          maxLength={100}
                          required
                          onChange={(e) =>
                            group(i, {
                              modifiers: g.modifiers.map((m, k) =>
                                k === j ? { ...m, name: e.target.value } : m,
                              ),
                            })
                          }
                          className={fieldClass}
                        />
                      </label>
                      <label className="w-28">
                        {t("Extra (R$)")}
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={m.price_cents / 100}
                          onChange={(e) =>
                            group(i, {
                              modifiers: g.modifiers.map((m, k) =>
                                k === j
                                  ? {
                                      ...m,
                                      price_cents: Math.round(
                                        Number(e.target.value) * 100,
                                      ),
                                    }
                                  : m,
                              ),
                            })
                          }
                          className={fieldClass}
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={t("Remover opção {n} do grupo {group}", { n: j + 1, group: i + 1 })}
                        className="mb-3 text-destructive"
                        onClick={() =>
                          group(i, {
                            modifiers: g.modifiers.filter((_, k) => k !== j),
                          })
                        }
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {languages && (
                      <TranslationFields
                        compact
                        value={m.translations ?? {}}
                        fields={["name"]}
                        onChange={(next) =>
                          group(i, {
                            modifiers: g.modifiers.map((m, k) =>
                              k === j ? { ...m, translations: next } : m,
                            ),
                          })
                        }
                      />
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="mt-2 flex items-center gap-2 text-sm text-primary"
                  onClick={() =>
                    group(i, {
                      modifiers: [
                        ...g.modifiers,
                        {
                          name: "",
                          price_cents: 0,
                          position: g.modifiers.length,
                          translations: {},
                        },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  {t("Adicionar opção")}
                </button>
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            className="mt-4 rounded-xl border px-4 py-3"
            onClick={() =>
              set("groups", [
                ...value.groups,
                {
                  name: "",
                  translations: {},
                  required: false,
                  min_select: 0,
                  max_select: 1,
                  position: value.groups.length,
                  modifiers: [{ name: "", price_cents: 0, position: 0, translations: {} }],
                },
              ])
            }
          >
            {t("Adicionar grupo")}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {t(error)}
          </p>
        )}
        <div className="flex gap-4">
          <button className={actionClass} disabled={busy}>
            {busy ? t("Salvando…") : t("Salvar item")}
          </button>
          <button type="button" onClick={onClose}>
            {t("Voltar ao cardápio")}
          </button>
        </div>
      </form>
    </section>
  );
}
