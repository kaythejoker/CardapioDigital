"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Store, X } from "lucide-react";
import {
  AdminShell,
  actionClass,
  fieldClass,
  ImageUpload,
  jsonRequest,
  panelClass,
  TeamForm,
} from "@/components/admin-ui";

type ResellerData = {
  reseller: {
    id: string;
    name: string;
    brand_name: string;
    logo_url: string | null;
    primary_color: string;
    domain: string | null;
  };
  restaurants: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "inactive";
    created_at: string;
  }[];
};
export function Reseller() {
  const [data, setData] = useState<ResellerData | null>(null);
  const [view, setView] = useState("restaurants");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await jsonRequest("/api/revenda"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    return () => clearTimeout(initial);
  }, [refresh]);
  const save = async (body: unknown) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await jsonRequest("/api/revenda", body);
      await refresh();
      setMessage("Alterações salvas");
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente");
      return null;
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <main className="p-8">
        <p>{error || "Carregando sua revenda…"}</p>
        <Link href="/app/login" className="mt-5 inline-block underline">
          Entrar
        </Link>
      </main>
    );
  const active = data.restaurants.filter((r) => r.status === "active").length;
  return (
    <AdminShell
      brand={data.reseller}
      title={
        view === "brand"
          ? "Sua marca, em cada restaurante"
          : "Seus restaurantes"
      }
      active={view}
      onNavigate={(v) => {
        setView(v);
        setInvite(null);
      }}
      revenda
    >
      {error && (
        <p
          role="alert"
          className="mb-6 rounded-xl bg-destructive p-4 text-white"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mb-6 rounded-xl bg-[#2F7D5B]/10 p-4 text-[#2F7D5B]"
        >
          {message}
        </p>
      )}
      {view === "restaurants" ? (
        <>
          <div className="reseller-stats mb-6 grid gap-4 sm:grid-cols-2">
            <section className={panelClass}>
              <p className="text-muted-foreground">Restaurantes ativos</p>
              <b className="mt-3 block font-heading text-4xl">{active}</b>
              <p className="mt-2 text-sm text-muted-foreground">
                Situação atual para acompanhamento do mês
              </p>
            </section>
            <section className={panelClass}>
              <p className="text-muted-foreground">Total de restaurantes</p>
              <b className="mt-3 block font-heading text-4xl">
                {data.restaurants.length}
              </b>
            </section>
          </div>
          <form
            className={`${panelClass} mb-7`}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const values = new FormData(form);
              const result = await save({
                action: "create",
                name: values.get("name"),
                slug: values.get("slug"),
              });
              if (result) {
                form.reset();
                setInvite(result.data.id);
              }
            }}
          >
            <h3 className="mb-5 font-heading text-2xl">Novo restaurante</h3>
            <div className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
              <label>
                Nome
                <input
                  name="name"
                  required
                  maxLength={100}
                  className={fieldClass}
                />
              </label>
              <label>
                Endereço do cardápio
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  minLength={2}
                  maxLength={80}
                  placeholder="brasa-bistro"
                  className={fieldClass}
                />
              </label>
              <button disabled={busy} className={actionClass}>
                Criar restaurante
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Use letras minúsculas, números e hífens no endereço.
            </p>
          </form>
          {invite && (
            <section className="mb-7">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-heading text-xl">
                  Gestor de{" "}
                  {data.restaurants.find((r) => r.id === invite)?.name}
                </h3>
                <button
                  aria-label="Fechar convite"
                  onClick={() => setInvite(null)}
                >
                  <X />
                </button>
              </div>
              <TeamForm
                key={invite}
                restaurantId={invite}
                manager
                onSaved={() => void refresh()}
              />
            </section>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {data.restaurants.map((r) => (
              <article key={r.id} className={`${panelClass} restaurant-card`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Store className="text-primary" />
                    <h3 className="font-heading text-2xl">{r.name}</h3>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${r.status === "active" ? "bg-[#2F7D5B]/10 text-[#2F7D5B]" : "bg-secondary text-muted-foreground"}`}
                  >
                    {r.status === "active" ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <p className="my-4 text-sm text-muted-foreground">/{r.slug}</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <Link
                    href={`/app/gestor?restaurant_id=${r.id}`}
                    className="text-primary underline"
                  >
                    Gerenciar restaurante
                  </Link>
                  <button
                    onClick={() => setInvite(r.id)}
                    className="text-primary underline"
                  >
                    Convidar gestor
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void save({
                        action: "status",
                        id: r.id,
                        status: r.status === "active" ? "inactive" : "active",
                      })
                    }
                    className={
                      r.status === "active"
                        ? "text-destructive underline"
                        : "text-[#2F7D5B] underline"
                    }
                  >
                    {r.status === "active" ? "Desativar" : "Ativar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <BrandForm reseller={data.reseller} busy={busy} onSave={save} />
      )}
    </AdminShell>
  );
}
function BrandForm({
  reseller,
  busy,
  onSave,
}: {
  reseller: ResellerData["reseller"];
  busy: boolean;
  onSave: (body: unknown) => Promise<unknown>;
}) {
  const [logo, setLogo] = useState(reseller.logo_url);
  const [color, setColor] = useState(reseller.primary_color);
  return (
    <form
      className={`${panelClass} max-w-2xl space-y-5`}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void onSave({
          action: "brand",
          name: form.get("name"),
          brand_name: form.get("brand_name"),
          domain: form.get("domain"),
          primary_color: color,
          logo_url: logo,
        });
      }}
    >
      <label className="block">
        Nome da revenda
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={reseller.name}
          className={fieldClass}
        />
      </label>
      <label className="block">
        Nome do produto
        <input
          name="brand_name"
          required
          maxLength={100}
          defaultValue={reseller.brand_name}
          className={fieldClass}
        />
      </label>
      <ImageUpload
        kind="reseller"
        id={reseller.id}
        value={logo}
        onChange={setLogo}
        label="Logo da marca"
      />
      <label className="block">
        Cor principal
        <div className="mt-3 flex items-center gap-4">
          <input
            type="color"
            aria-label="Cor principal"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-12 w-16"
          />
          <span>{color.toUpperCase()}</span>
        </div>
      </label>
      <label className="block">
        Domínio
        <input
          name="domain"
          placeholder="comanda.com.br"
          defaultValue={reseller.domain || ""}
          className={fieldClass}
        />
      </label>
      <p className="text-sm text-muted-foreground">
        O nome, o logo e a cor aparecem em todos os restaurantes da revenda. O
        domínio precisa estar conectado à hospedagem para servir o site.
      </p>
      <button disabled={busy} className={actionClass}>
        Salvar marca
      </button>
    </form>
  );
}
