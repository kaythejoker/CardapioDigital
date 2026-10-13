# Cardápio Digital — contexto para agentes

SaaS white label de cardápio digital com pedido por mesa: o cliente escaneia o QR da mesa, digita um PIN de 4 dígitos que o garçom passa e envia o pedido, que cai numa fila priorizada na tela da cozinha. Vendido por um revendedor (Felipe) para restaurantes, cada um isolado dos outros.

## Fonte da verdade

- **[docs/spec.md](docs/spec.md)** — spec completa do MVP (papéis, fluxos, regras de negócio, 20 telas, arquitetura, tabelas, fases, critérios de aceite, perguntas em aberto).
- A seção **"Prompt 1 — Aplicação"** da spec é a instrução de construção: stack, modelo de dados, regras que não podem falhar, prioridade da fila, rotas, tokens visuais e a ordem das 8 etapas. Siga-a.
- A seção **"Prompt 2 — Visual (ChatGPT)"** define as referências; as 7 imagens estão em `docs/referencias-visuais/`.
- Original no claude.ai: https://claude.ai/artifact/KM3dTUAMjh1ZdTj1z6jZX7 (exportado em 2026-10-09, rev 13).

## Como trabalhar

- Construir em **8 etapas**. Ao fim de cada uma: rodar o projeto, conferir que funciona, mostrar um resumo curto do que foi feito e de como testar, e **esperar o ok do usuário** antes da próxima.
- Em 2026-10-09 o usuário autorizou continuar **até terminar a spec**, sem precisar de novo ok entre etapas. **Etapas 1–8 concluídas**, com os ajustes autorizados de 10/10; consultar `docs/progresso.md` para evidências. Não reiniciar a implementação por etapas ao abrir este repositório em outra máquina.
- Não implementar nada fora do escopo do MVP sem perguntar. Se algo estiver ambíguo, perguntar antes de decidir.
- Toda a interface e a comunicação com o usuário são em **português do Brasil**.
- Valores em centavos (inteiros), moeda BRL, fuso `America/Sao_Paulo`.

## Estado atual (2026-10-13)

- Implementação completa da V0 reunida no Git para sincronização entre máquinas: cliente, salão, cozinha, gestor, revenda, personalização, favicon, testes e migrations. O antigo commit `0343caa` continha apenas o setup; não representa o estado atual do produto.
- Os sócios estão testando. **Preservar dados, contas, senhas, QR codes e PINs**; o usuário cancelou a limpeza da demonstração em 10/10. Não executar seeds ou resets ao preparar outro PC.

- O usuário confirmou **dois projetos Vercel**: painel `cardapio-digital` e público `cardapio-cliente`, ambos no mesmo repo e Supabase. `APP_SURFACE` separa as publicações; `NEXT_PUBLIC_MENU_URL` define a origem dos QR codes.
- Visual revisto com as sete referências; gestor e cozinha em desktop, cliente e salão em celular. Cores do restaurante podem sobrescrever a revenda; nome, logo, banner e cardápio editáveis pelo gestor.
- **PIN por comanda aberta**, com vários pedidos; fechamento invalida PIN e sessões.
- Demonstração dos sócios: `socios@comanda.dev`, restaurante `brasa-demo`, 23 itens e 12 mesas. Senha apenas em `DEMO_USER_PASSWORD` local e nos artefatos privados de entrega. Não refazer o seed nem fechar a mesa 12 da demonstração sem necessidade.
- 21 capturas de telas/estados, apresentação de 18 slides e QR codes em `output/v0/`, ignorado pelo Git e deploy. E2E em produção: 4 cenários aprovados em 10/10/2026.

- Repo git: branch `main`, remote `origin` = https://github.com/kaythejoker/CardapioDigital.git.
- **Projeto Supabase: `yekmailbymutimhmddzx`** (https://supabase.com/dashboard/project/yekmailbymutimhmddzx). Use só este projeto para o Cardápio Digital.
- As imagens de referência do Prompt 2 estão em `docs/referencias-visuais/` (7 telas).
- **Etapas 1–8 implementadas e publicadas** em https://cardapio-digital-sigma-ten.vercel.app, com seed e cinco contas demo. Critérios, evidências e decisões em `docs/progresso.md`.
  - Next.js 16.4 (`cacheComponents` ligado; `proxy.ts` substitui o middleware) + Tailwind 4 + shadcn/ui (radix, preset nova). Tokens de cor e fonte em `app/globals.css`; tema escuro da cozinha = classe `.dark`.
  - Clientes Supabase em `lib/supabase/`: `server.ts` (equipe, RLS), `client.ts` (navegador), `admin.ts` (chave secreta, só para as rotas do cliente anônimo).
  - Migration `supabase/migrations/20261009120000_schema_inicial.sql`: tabelas do Prompt 1 + RLS + triggers de integridade. Fechar a comanda apaga as sessões. O status do pedido só avança na ordem da spec. A cozinha só altera `sold_out`. Só o revendedor muda status ou slug do restaurante.
  - `supabase/seed.sql`: 1 revenda, Brasa Bistrô (20 itens com fotos e adicionais) e Cantina da Nonna (5 itens, para testar o isolamento), 8 mesas cada.
  - `npm run db:check` valida todas as migrations e seed no PGlite, sem Docker (54 verificações). Quatro testes unitários e quatro cenários E2E; `QA_BASE_URL` permite testar produção.
  - Contas de demonstração: `npm run db:seed-users`, que precisa do projeto Supabase.
- Desvio da spec: a tabela `menu_items` ganhou a coluna `featured`, para a seção "Destaques da casa" da tela 1, que o modelo de dados não cobria.

## Decisões

- **Supabase:** projeto na nuvem `yekmailbymutimhmddzx`. A máquina não tem Docker, então não há Supabase local.
- **Vercel:** `nutrivox/cardapio-digital` (equipe) e `nutrivox/cardapio-cliente` (cliente), funções em São Paulo, variáveis configuradas, deploy pela pasta local. Sem commit/push automático.
- **Equipe:** o usuário escolheu senha inicial por enquanto; SMTP e entrega de convites por e-mail ficam adiados. Senha demo somente no `.env.local` ignorado.
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
