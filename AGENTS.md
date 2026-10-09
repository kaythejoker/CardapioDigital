# Cardápio Digital — contexto para agentes

SaaS white label de cardápio digital com pedido por mesa: o cliente escaneia o QR da mesa, digita um PIN de 4 dígitos que o garçom passa e envia o pedido, que cai numa fila priorizada na tela da cozinha. Vendido por um revendedor (Felipe) para restaurantes, cada um isolado dos outros.

## Fonte da verdade

- **[docs/spec.md](docs/spec.md)** — spec completa do MVP (papéis, fluxos, regras de negócio, 20 telas, arquitetura, tabelas, fases, critérios de aceite, perguntas em aberto).
- A seção **"Prompt 1 — Aplicação"** da spec é a instrução de construção: stack, modelo de dados, regras que não podem falhar, prioridade da fila, rotas, tokens visuais e a ordem das 8 etapas. Siga-a.
- A seção **"Prompt 2 — Visual (ChatGPT)"** gera as imagens de referência das telas. Elas ainda não foram geradas nem anexadas ao repo.
- Original no claude.ai: https://claude.ai/artifact/KM3dTUAMjh1ZdTj1z6jZX7 (exportado em 2026-10-09, rev 13).

## Como trabalhar

- Construir em **8 etapas**. Ao fim de cada uma: rodar o projeto, conferir que funciona, mostrar um resumo curto do que foi feito e de como testar, e **esperar o ok do usuário** antes da próxima.
- Não implementar nada fora do escopo do MVP sem perguntar. Se algo estiver ambíguo, perguntar antes de decidir.
- Toda a interface e a comunicação com o usuário são em **português do Brasil**.
- Valores em centavos (inteiros), moeda BRL, fuso `America/Sao_Paulo`.

## Estado atual (2026-10-09)

- Repo git: branch `main`, remote `origin` = https://github.com/kaythejoker/CardapioDigital.git.
- **Projeto Supabase: `yekmailbymutimhmddzx`** (https://supabase.com/dashboard/project/yekmailbymutimhmddzx). Use só este projeto para o Cardápio Digital.
- As imagens de referência do Prompt 2 estão em `docs/referencias-visuais/` (7 telas).
- **Etapa 1 (Setup) feita no código, ainda não aplicada em nenhum banco**, porque o projeto Supabase não existe. Falta o ok do usuário para seguir para a etapa 2.
  - Next.js 16.4 (`cacheComponents` ligado; `proxy.ts` substitui o middleware) + Tailwind 4 + shadcn/ui (radix, preset nova). Tokens de cor e fonte em `app/globals.css`; tema escuro da cozinha = classe `.dark`.
  - Clientes Supabase em `lib/supabase/`: `server.ts` (equipe, RLS), `client.ts` (navegador), `admin.ts` (chave secreta, só para as rotas do cliente anônimo).
  - Migration `supabase/migrations/20261009120000_schema_inicial.sql`: tabelas do Prompt 1 + RLS + triggers de integridade. Fechar a comanda apaga as sessões. O status do pedido só avança na ordem da spec. A cozinha só altera `sold_out`. Só o revendedor muda status ou slug do restaurante.
  - `supabase/seed.sql`: 1 revenda, Brasa Bistrô (20 itens com fotos e adicionais) e Cantina da Nonna (5 itens, para testar o isolamento), 8 mesas cada.
  - `npm run db:check` valida migration e seed no PGlite, sem Docker (32 verificações de RLS e regras).
  - Contas de demonstração: `npm run db:seed-users`, que precisa do projeto Supabase.
- Desvio da spec: a tabela `menu_items` ganhou a coluna `featured`, para a seção "Destaques da casa" da tela 1, que o modelo de dados não cobria.

## Decisões

- **Supabase:** projeto na nuvem `yekmailbymutimhmddzx`. A máquina não tem Docker, então não há Supabase local.
- **Perguntas em aberto da spec** (marca do Felipe, bar separado da cozinha, taxa de 10%, mais de uma comanda por mesa, acesso do garçom, quem monta o cardápio, domínio): por enquanto seguimos o modelo de dados do Prompt 1. Quando o Felipe responder, os ajustes entram como migrations novas.

Não use o projeto Supabase **GrowthTracker** para nada deste repo: ele pertence a outro produto.

## Ambiente de desenvolvimento

- Windows 11; Node 24.15, npm 11.12.
- Sem Docker; a Supabase CLI não está instalada (usar `npx supabase ...`).
- `gh` autenticado como `kaythejoker`.
- Commit ou push só quando o usuário pedir.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
