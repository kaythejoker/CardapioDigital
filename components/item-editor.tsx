"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { type ItemInput } from "@/lib/manage-schema";
import { type MenuItem } from "@/lib/menu-types";
import {
  actionClass,
  fieldClass,
  ImageUpload,
  jsonRequest,
  panelClass,
} from "@/components/admin-ui";

export function ItemEditor({
  restaurantId,
  categories,
  item,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  categories: { id: string; name: string }[];
  item: (MenuItem & { active: boolean; position: number }) | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
          groups: item.modifier_groups
            .toSorted((a, b) => a.position - b.position)
            .map((g) => ({
              name: g.name,
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
          {item ? "Editar item" : "Novo item"}
        </h3>
        <button onClick={onClose} aria-label="Fechar editor">
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
            Nome
            <input
              value={value.name}
              maxLength={100}
              required
              onChange={(e) => set("name", e.target.value)}
              className={fieldClass}
            />
          </label>
          <label>
            Categoria
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
          Descrição
          <textarea
            value={value.description}
            maxLength={1000}
            onChange={(e) => set("description", e.target.value)}
            className={fieldClass}
          />
        </label>
        <div className="grid gap-5 md:grid-cols-2">
          <label>
            Preço (R$)
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
            Preparo (minutos)
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
        <ImageUpload
          kind="restaurant"
          id={restaurantId}
          value={value.photo_url || null}
          onChange={(url) => set("photo_url", url)}
          label="Foto do item"
        />
        <div className="flex gap-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            Ativo
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.featured}
              onChange={(e) => set("featured", e.target.checked)}
            />
            Destaque da casa
          </label>
        </div>
        <div>
          <h4 className="mb-4 font-heading text-2xl">Grupos de adicionais</h4>
          <div className="space-y-4">
            {value.groups.map((g, i) => (
              <fieldset key={i} className="rounded-2xl border p-4">
                <legend className="px-2 font-semibold">Grupo {i + 1}</legend>
                <div className="flex items-end gap-3">
                  <label className="flex-1">
                    Nome do grupo
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
                    aria-label={`Remover grupo ${i + 1}`}
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
                    Obrigatório
                  </label>
                  <label>
                    Mínimo
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
                    Máximo
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
                  <div key={j} className="mb-3 flex items-end gap-3">
                    <label className="flex-1">
                      Opção {j + 1}
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
                      Extra (R$)
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
                      aria-label={`Remover opção ${j + 1} do grupo ${i + 1}`}
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
                        },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  Adicionar opção
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
                  required: false,
                  min_select: 0,
                  max_select: 1,
                  position: value.groups.length,
                  modifiers: [{ name: "", price_cents: 0, position: 0 }],
                },
              ])
            }
          >
            Adicionar grupo
          </button>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-4">
          <button className={actionClass} disabled={busy}>
            {busy ? "Salvando…" : "Salvar item"}
          </button>
          <button type="button" onClick={onClose}>
            Voltar ao cardápio
          </button>
        </div>
      </form>
    </section>
  );
}
