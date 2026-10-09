# Comanda — Cardápio Digital com Pedido por Mesa

SaaS white label: o cliente escaneia o QR da mesa, digita o PIN que o garçom passa e envia o pedido, que cai priorizado na tela da cozinha. Spec completa em [docs/spec.md](docs/spec.md); telas de referência em [docs/referencias-visuais](docs/referencias-visuais).

Stack: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui, Supabase (Postgres com RLS, Auth, Realtime, Storage), deploy na Vercel.

## Rodando

```bash
npm install
cp .env.example .env.local   # preencha com as chaves do projeto Supabase
npm run dev
```

## Banco de dados

As migrations ficam em `supabase/migrations` e os dados de exemplo em `supabase/seed.sql`.

| Comando | O que faz |
| --- | --- |
| `npm run db:check` | Aplica migrations e seed num Postgres em memória (PGlite) e testa RLS e regras. Não precisa de Docker nem de Supabase. |
| `npx supabase link --project-ref <ref>` | Liga a pasta a um projeto Supabase na nuvem. |
| `npx supabase db push --include-seed` | Aplica migrations e seed no projeto ligado. |
| `npm run db:seed-users` | Cria as contas de demonstração (precisa de `SEED_USER_PASSWORD` no `.env.local`). |

Contas de demonstração: `revenda@comanda.dev` (revendedor), `gestor@brasa.dev`, `garcom@brasa.dev`, `cozinha@brasa.dev` (Brasa Bistrô) e `gestor@cantina.dev` (Cantina da Nonna, para testar o isolamento).

## Verificações

```bash
npm run typecheck
npm run lint
npm run build
npm run db:check
```
