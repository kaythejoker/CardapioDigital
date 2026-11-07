"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MesaClickLogo } from "@/components/brand-mark";
import { LanguageSwitcher, useI18n } from "@/components/i18n";
import { msg } from "@/lib/i18n";

export default function Login() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="panel-theme flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-sm rounded-[28px] border bg-card p-8 shadow-sm">
        <div className="mb-2 flex justify-end">
          <LanguageSwitcher compact />
        </div>
        <MesaClickLogo className="login-logo" priority />
        <p className="login-tagline">{t("Seu atendimento em outro nível.")}</p>
        <h1 className="mt-8 font-heading text-3xl">{t("Bem-vindo ao MesaClick")}</h1>
        <p className="mb-7 mt-3 text-muted-foreground">{t("Entre para cuidar de cada mesa.")}</p>
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const res = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error);
              router.push("/app");
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : msg("Sem conexão"));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block">{t("E-mail")}<input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border p-3"
            />
          </label>
          <label className="block">{t("Senha")}<input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-xl border p-3"
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {t(error)}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-xl bg-primary p-4 font-semibold text-primary-foreground"
          >
            {busy ? t("Entrando…") : t("Entrar")}
          </button>
        </form>
        <Link href="/" className="mt-6 block text-center text-sm underline">{t("Voltar")}</Link>
      </section>
    </main>
  );
}
