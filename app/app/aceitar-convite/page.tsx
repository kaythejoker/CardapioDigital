"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n";
import { msg } from "@/lib/i18n";

export default function AcceptInvitation() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const db = createClient();
    void db.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data } = db.auth.onAuthStateChange((_event, session) =>
      setReady(!!session),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <main className="mx-auto w-full max-w-md p-8">
      <h1 className="font-heading text-3xl">{t("Bem-vindo à equipe")}</h1>
      <p className="my-5">{t("Escolha sua senha para começar.")}</p>
      {ready ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const { error } = await createClient().auth.updateUser({
              password,
            });
            setBusy(false);
            if (error) setError(msg("Não foi possível salvar sua senha"));
            else {
              router.push("/app");
              router.refresh();
            }
          }}
        >
          <label>{t("Nova senha")}<input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="my-3 w-full rounded-xl border bg-card p-4"
            />
          </label>
          <p className="text-sm text-muted-foreground">{t("Use pelo menos 12 caracteres.")}</p>
          {error && (
            <p role="alert" className="my-4 text-destructive">
              {t(error)}
            </p>
          )}
          <button
            disabled={busy}
            className="mt-5 w-full rounded-xl bg-primary p-4 text-primary-foreground"
          >{t("Salvar senha e entrar")}</button>
        </form>
      ) : (
        <p>{t("Abra o link recebido por e-mail. Se ele expirou, peça um novo convite ao gestor.")}</p>
      )}
    </main>
  );
}
