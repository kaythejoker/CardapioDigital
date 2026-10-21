"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  BarChart3,
  ChefHat,
  CreditCard,
  History,
  Home,
  Star,
  LayoutGrid,
  LogOut,
  Package,
  Palette,
  QrCode,
  Settings,
  Store,
  Upload,
  Users,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { HelpButton, type Support } from "@/components/support";
import { brandForeground } from "@/lib/menu-types";
import {
  defaultPermission,
  effectivePermissions,
  MEMBER_ROLES,
  PERMISSIONS,
  ROLE_LABELS,
  type Permissions,
} from "@/lib/permissions";

export const fieldClass =
  "admin-field mt-2 w-full rounded-xl border bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary";
export const actionClass =
  "admin-action rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50";
export const panelClass = "admin-panel rounded-[20px] border bg-card p-5 shadow-sm";
export async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir");
  return data;
}

export function AdminShell({
  brand,
  title,
  active,
  onNavigate,
  revenda,
  children,
  restaurant,
  views,
  support,
  features,
}: {
  brand: { brand_name: string; primary_color: string; logo_url: string | null };
  title: string;
  active: string;
  onNavigate: (view: string) => void;
  revenda?: boolean;
  restaurant?: { name: string; logo_url: string | null; menuUrl?: string };
  /** Itens do menu visíveis para esta pessoa; vazio = todos. */
  views?: readonly string[];
  /** Contato de suporte da revenda para o botão Ajuda. */
  support?: Support;
  /** Módulos do plano: esconde atalhos como o Bar. */
  features?: Partial<Record<string, boolean>>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  useEffect(() => {
    const initial = setTimeout(
      () =>
        setDate(
          new Date().toLocaleDateString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
        ),
      0,
    );
    return () => clearTimeout(initial);
  }, []);
  const nav = (
    revenda
      ? [
          { id: "restaurants", label: "Restaurantes", icon: Store },
          { id: "plans", label: "Planos", icon: CreditCard },
          { id: "brand", label: "Marca", icon: Palette },
        ]
      : [
          { id: "home", label: "Início", icon: Home },
          { id: "menu", label: "Cardápio", icon: UtensilsCrossed },
          { id: "stock", label: "Estoque", icon: Package },
          { id: "finance", label: "Financeiro", icon: Banknote },
          { id: "reports", label: "Relatórios", icon: BarChart3 },
          { id: "history", label: "Histórico", icon: History },
          { id: "survey", label: "Satisfação", icon: Star },
          { id: "tables", label: "Mesas e QR", icon: QrCode },
          { id: "team", label: "Equipe", icon: Users },
          { id: "settings", label: "Configurações", icon: Settings },
        ]
  ).filter((n) => (!views?.length || views.includes(n.id)) && featureFor(n.id, features));
  const style = {
    "--brand": brand.primary_color,
    "--brand-foreground": brandForeground(brand.primary_color),
  } as CSSProperties;
  return (
    <main
      style={style}
      data-view={active}
      className="brand-scope admin-layout"
    >
      <aside className="admin-sidebar">
        <div className="admin-brand">
          {brand.logo_url ? (
            <Image
              src={brand.logo_url}
              alt={brand.brand_name}
              width={44}
              height={44}
              className="object-contain"
            />
          ) : (
            <BrandMark className="text-primary" />
          )}
          <div>
            <h1 className="font-heading text-2xl font-semibold">
              {brand.brand_name}
            </h1>
            <p className="text-xs text-muted-foreground">
              Mais tempo para o que importa.
            </p>
          </div>
        </div>
        <p className="navigation-label">{revenda ? "Administração" : "Restaurante"}</p>
        <nav
          className="admin-navigation"
          aria-label="Menu do painel"
        >
          {nav.map((n) => (
            <button
              key={n.id}
              aria-current={active === n.id ? "page" : undefined}
              onClick={() => onNavigate(n.id)}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left ${active === n.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary"}`}
            >
              <n.icon size={20} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="admin-shortcuts">
          <Link className="flex items-center gap-2" href="/app">
            <LayoutGrid size={18} />
            Meus painéis
          </Link>
          {!revenda && (
            <>
              <Link className="flex items-center gap-2" href="/app/cozinha">
                <ChefHat size={18} />
                Cozinha
              </Link>
              {features?.bar !== false && (
                <Link className="flex items-center gap-2" href="/app/bar">
                  <Wine size={18} />
                  Bar
                </Link>
              )}
              <Link className="flex items-center gap-2" href="/app/garcom">
                <Users size={18} />
                Salão
              </Link>
            </>
          )}
          {support && <HelpButton support={support} context={revenda ? "painel da revenda" : `painel do gestor${restaurant ? ` de ${restaurant.name}` : ""}`} />}
          <button
            className="flex items-center gap-2 text-left"
            onClick={async () => {
              await fetch("/api/auth", { method: "DELETE" });
              router.push("/app/login");
              router.refresh();
            }}
          >
            <LogOut size={18} />
            Sair
          </button>
        </div>
        {restaurant && <div className="admin-restaurant"><div className="flex items-center gap-3">{restaurant.logo_url ? <Image src={restaurant.logo_url} alt="" width={40} height={40} className="rounded-full" /> : <span className="restaurant-avatar"><Store size={21}/></span>}<div><strong>{restaurant.name}</strong><small>Restaurante</small></div></div>{restaurant.menuUrl && <Link href={restaurant.menuUrl} target="_blank">Ver cardápio do cliente ↗</Link>}</div>}
      </aside>
      <div className="admin-content">
        <header className="admin-header">
          <div><span className="admin-eyebrow">{revenda ? "Central da revenda" : restaurant?.name || "Gestão do restaurante"}</span><h2 className="font-heading text-3xl font-semibold lg:text-4xl">
            {title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{date}</p></div><Link href="/app" className="admin-account"><span>{revenda ? "R" : "G"}</span><div><strong>{revenda ? "Revendedor" : "Gestor"}</strong><small>Meus painéis</small></div><span aria-hidden="true">⌄</span></Link>
        </header>
        {children}
      </div>
    </main>
  );
}

/** Esconde no menu as telas de módulos fora do plano. */
function featureFor(view: string, features?: Partial<Record<string, boolean>>) {
  const key = { stock: "stock", finance: "finance", reports: "reports", survey: "surveys" }[view];
  return !key || features?.[key] !== false;
}

export function ImageUpload({
  kind,
  id,
  value,
  onChange,
  label,
  preview,
}: {
  kind: "restaurant" | "reseller";
  id: string;
  value: string | null;
  onChange: (url: string) => void;
  label: string;
  preview?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <p className="font-medium">{label}</p>
      {value && (preview ?? (
        <Image
          src={value}
          alt={label}
          width={200}
          height={120}
          className="my-3 max-h-32 rounded-xl object-cover"
        />
      ))}
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border bg-card px-4 py-3">
        <Upload size={18} />
        {busy ? "Enviando…" : "Escolher imagem"}
        <input
          type="file"
          aria-label={label}
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              const form = new FormData();
              form.set("file", file);
              form.set("kind", kind);
              form.set("id", id);
              const res = await fetch("/api/upload", {
                method: "POST",
                body: form,
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error);
              onChange(data.url);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Falha no upload");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        JPG, PNG ou WebP, até 5 MB.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const STAFF_ROLES = MEMBER_ROLES.filter((r) => r !== "manager");

/** Papéis de uma pessoa da equipe (sem o de gestor, que só a revenda dá). */
export function RolePicker({
  value,
  onChange,
  name,
}: {
  value: readonly string[];
  onChange: (roles: string[]) => void;
  name?: string;
}) {
  return (
    <fieldset className="role-picker">
      <legend className="mb-2">Papéis</legend>
      <div className="flex flex-wrap gap-3">
        {STAFF_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2 rounded-xl border px-3 py-2">
            <input
              type="checkbox"
              name={name}
              value={role}
              checked={value.includes(role)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, role]
                    : value.filter((r) => r !== role),
                )
              }
            />
            {ROLE_LABELS[role]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Permissões efetivas com o padrão do papel já marcado; o ajuste fica em `value`. */
export function PermissionPicker({
  roles,
  value,
  onChange,
}: {
  roles: readonly string[];
  value: Permissions;
  onChange: (permissions: Permissions) => void;
}) {
  const effective = effectivePermissions(roles, value);
  const manager = roles.includes("manager");
  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];
  return (
    <div className="permission-picker space-y-3">
      {groups.map((group) => (
        <fieldset key={group}>
          <legend className="mb-2 text-sm text-muted-foreground">{group}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSIONS.filter((p) => p.group === group).map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={p.label}
                  checked={effective[p.key]}
                  disabled={manager}
                  onChange={(e) => {
                    const next = { ...value };
                    if (e.target.checked === defaultPermission(roles, p.key))
                      delete next[p.key];
                    else next[p.key] = e.target.checked;
                    onChange(next);
                  }}
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {manager && (
        <p className="text-xs text-muted-foreground">O gestor tem todas as permissões.</p>
      )}
    </div>
  );
}

export function TeamForm({
  restaurantId,
  manager,
  onSaved,
}: {
  restaurantId: string;
  manager?: boolean;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState("password");
  const [roles, setRoles] = useState<string[]>(["waiter"]);
  const [permissions, setPermissions] = useState<Permissions>({});
  return (
    <form
      className={`${panelClass} space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const values = new FormData(form);
        if (!manager && !roles.length) {
          setError("Escolha pelo menos um papel");
          return;
        }
        setBusy(true);
        setError("");
        setMessage("");
        try {
          const data = await jsonRequest(`/api/team/${restaurantId}`, {
            name: values.get("name"),
            email: values.get("email"),
            roles: manager ? ["manager"] : roles,
            permissions: manager ? {} : permissions,
            ...(mode === "password"
              ? { password: values.get("password") }
              : {}),
          });
          setMessage(data.message);
          form.reset();
          setRoles(["waiter"]);
          setPermissions({});
          onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Tente novamente");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-heading text-2xl">
        {manager ? "Convidar gestor" : "Adicionar à equipe"}
      </h3>
      <label className="block">
        Nome
        <input name="name" required maxLength={100} className={fieldClass} />
      </label>
      <label className="block">
        E-mail
        <input name="email" type="email" required className={fieldClass} />
      </label>
      {!manager && (
        <>
          <RolePicker
            value={roles}
            onChange={(next) => {
              setRoles(next);
              setPermissions({});
            }}
          />
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm">Permissões (padrão do papel)</summary>
            <div className="mt-3">
              <PermissionPicker roles={roles} value={permissions} onChange={setPermissions} />
            </div>
          </details>
        </>
      )}
      <label className="block">
        Tipo de acesso
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className={fieldClass}
        >
          <option value="invite">Convite por e-mail</option>
          <option value="password">Criar com senha inicial</option>
        </select>
      </label>
      {mode === "password" && (
        <label className="block">
          Senha inicial
          <input
            aria-label="Senha inicial"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={72}
            className={fieldClass}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Pelo menos 12 caracteres. Passe a senha à pessoa.
          </p>
        </label>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-[#2F7D5B]">
          {message}
        </p>
      )}
      <button disabled={busy} className={actionClass}>
        {busy
          ? "Salvando…"
          : mode === "invite"
            ? "Enviar convite"
            : "Criar acesso"}
      </button>
    </form>
  );
}
