# Comanda — Cardápio Digital com Pedido por Mesa

MVP white label: cliente escaneia o QR, valida o PIN da mesa e envia pedidos à cozinha. Garçom, cozinha, gestor e revenda têm acessos separados. A [spec](docs/spec.md) define o escopo; [progresso e evidências](docs/progresso.md) registram a entrega.

**Estado em 21/10/2026: V0 (etapas 1–8) e Fase 2 ([spec-fase2.md](docs/spec-fase2.md), 11 etapas) concluídas e publicadas.** A Fase 2 trouxe papéis múltiplos e permissões por pessoa, registro de operações e histórico, cancelamento por item, estoque, alertas sonoros, chamar garçom e pedir a conta, painel do bar, união de mesas, financeiro (pagamentos por forma, taxa de serviço, desconto, fechamento do dia), relatórios com CSV, pesquisa de satisfação, planos e assinaturas por revenda, suporte e ajuda, domínio próprio e comanda do cliente atualizada a cada 3 s. O histórico inicial de setup não representa mais o estado da implementação.

**Produção:** https://cardapio-digital-sigma-ten.vercel.app
**Equipe:** https://cardapio-digital-sigma-ten.vercel.app/app/login

**Cardápio público:** https://cardapio-cliente-three.vercel.app

São dois projetos Vercel, com código compartilhado neste repositório e o mesmo Supabase. O painel abre a visão do cliente por um link direto. Cada mesa tem QR fixo; o PIN pertence à comanda aberta e vale para vários pedidos, até seu fechamento.

Next.js 16.4, TypeScript, Tailwind 4, shadcn/ui, Supabase (Postgres/RLS, Auth, Realtime, Storage) e Vercel. Valores em centavos, BRL, fuso America/Sao_Paulo.

## Acessar e testar

| Conta demo | Acesso |
| --- | --- |
| revenda@comanda.dev | Restaurantes e marca |
| gestor@brasa.dev | Gestor do Brasa Bistrô |
| garcom@brasa.dev | Mesas e comandas do Brasa |
| cozinha@brasa.dev | Cozinha do Brasa |
| gestor@cantina.dev | Gestor da Cantina, isolada do Brasa |
| socios@comanda.dev | Gestor, salão e cozinha do Brasa de demonstração (`brasa-demo`) |

A senha da revenda está em `SEED_RESELLER_PASSWORD` no `.env.local` desta máquina; as demais contas demo usam `SEED_USER_PASSWORD`. Não há senha fixa no código. Novos acessos são criados pela revenda/gestor com senha inicial, opção escolhida para esta implantação. Convites por e-mail dependem de SMTP próprio.

A conta dos sócios usa `DEMO_USER_PASSWORD`. Seu restaurante tem 23 itens, 12 mesas e pedidos fictícios para apresentar a operação. O script `npx tsx --env-file=.env.local scripts/prepare-partner-demo.ts` prepara esse restaurante separadamente do seed original; não o execute a cada deploy. A apresentação e os prints estão em `output/v0/`, fora do Git.

1. Entre como garçom, abra uma mesa e veja seu PIN.
2. No gestor, use **Mesas e QR → Abrir cardápio**, ou imprima o PDF e escaneie o QR.
3. Escolha um item, preencha adicionais obrigatórios, valide o PIN e envie.
4. Em outro navegador, entre na cozinha e toque **Iniciar** e **Pronto**.
5. No garçom, marque entregue e feche a comanda. A autorização do cliente é revogada imediatamente.

## Desenvolvimento

Para continuar em outro PC, atualize a branch `main` com `git pull --ff-only origin main` e execute `npm ci`. O `.env.local` não vai para o Git: configure-o a partir de `.env.example`, usando as credenciais existentes por um canal privado. Use o projeto Supabase já implantado, sem rodar seed, reset ou recriar contas: a demonstração está em uso pelos sócios.

Requer Node.js 24 e npm. Na pasta do repositório, em PowerShell:

```powershell
npm ci
Copy-Item .env.example .env.local
# Preencha o arquivo antes de iniciar.
npm run dev
```

| Variável | Uso |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | URL do Supabase |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Chave pública/publishable ou anon compatível |
| SUPABASE_SECRET_KEY | Chave secreta/service_role, só no servidor |
| NEXT_PUBLIC_APP_URL | Origem de fallback para desenvolvimento e convites |
| APP_SURFACE | admin no painel; customer no cardápio; vazio no desenvolvimento conjunto |
| NEXT_PUBLIC_ADMIN_URL | Origem do painel da equipe |
| NEXT_PUBLIC_MENU_URL | Origem pública dos QR codes e links do cliente |
| VERCEL_TOKEN | Token de conta da Vercel para registrar domínios próprios no projeto público; sem ele a tela só mostra as instruções de DNS |
| VERCEL_PROJECT_ID_MENU | Projeto público (`cardapio-cliente`) onde os domínios são registrados |
| VERCEL_TEAM_ID | Time `nutrivox` na Vercel |
| DEMO_USER_PASSWORD | Senha da demonstração dos sócios, somente local |
| SEED_USER_PASSWORD | Somente seed/testes locais; não enviar à Vercel |
| SEED_RESELLER_PASSWORD | Senha própria da revenda existente, usada nos testes locais |

Projeto Supabase: `yekmailbymutimhmddzx`, Nutrivox. Não usar GrowthTracker. Credenciais, .vercel/, testes gerados e PDFs de QA são ignorados pelo Git e pela publicação.

## Banco e Storage

Migrations incrementais em supabase/migrations; não editar as já aplicadas. O seed SQL contém dois restaurantes, mesas e cardápios. Ele já foi aplicado no projeto existente e não deve rodar em cada deploy.

| Comando | Uso |
| --- | --- |
| npm run db:check | Aplica migrations/seed em PGlite e verifica RLS/regras, sem Docker. |
| npx supabase migration new nome | Cria nova migration com timestamp da CLI. |
| npm run db:deploy | Aplica migrations pendentes pelo Management API; lê SUPABASE_ACCESS_TOKEN só do ambiente do processo. Destino fixo: projeto autorizado acima. |
| npm run storage:setup | Cria/atualiza restaurant-images, público para leitura, WebP até 5 MB; escrita pelas rotas autenticadas. |
| npm run db:seed-users | Cria/vincula contas demo com a senha definida localmente. |

O deploy registra cada migration e seu SQL em uma transação. O token de gerenciamento não pertence ao .env.local nem às variáveis da Vercel. Fotos JPG/PNG/WebP são validadas e reencodificadas por Sharp antes de gravar no Storage.

## Testes

```powershell
npm run typecheck
npm run lint
npm test
npm run db:check
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

Os E2E (13 cenários, um worker) usam o Supabase do .env.local, criam registros temporários identificáveis e removem esses registros em finally. Cobrem cliente/cozinha/garçom, segurança, implantação pelo painel, equipe, upload/PDF, prioridades e marca, e da Fase 2: estoque e cancelamento por item, chamadas e alertas, bar, união de mesas, financeiro, histórico/relatórios/pesquisa, assinaturas, domínio próprio (só local, pois depende do `Host`) e comanda em tempo real. SEED_USER_PASSWORD precisa corresponder às contas demo. Não rode limpeza do banco nem edite código durante a regressão: os testes dependem do servidor de desenvolvimento recompilar sem interrupção.

Para testar produção:

```powershell
$env:QA_BASE_URL = 'https://cardapio-digital-sigma-ten.vercel.app'
npm run test:e2e
npm run test:4g
Remove-Item Env:QA_BASE_URL
```

test:4g usa três contextos novos de Chromium, cache desativado, 9 Mbps/1,5 Mbps e latência 150 ms. Sem QA_BASE_URL, mede localhost:3001; inicie `npm run start -- --port 3001` após o build. Capturas em tmp/.

## Publicação

```powershell
npx vercel login
npx vercel link --yes --scope nutrivox --project cardapio-digital
npx vercel deploy --prod --yes --scope nutrivox
```

O CLI precisa estar logado numa conta com acesso ao time `nutrivox` (`npx vercel teams ls` deve listá-lo); a conta "duzz" não tem. No PowerShell desta máquina, scripts `.ps1` estão bloqueados: use `npx.cmd`. O terminal do app de desenvolvimento encerra o `vercel login` antes de o código do aparelho ser confirmado; rode-o num terminal comum ou em segundo plano.

O projeto já está vinculado. vercel.json define Next.js e funções em São Paulo (gru1), junto do banco. As três variáveis Supabase estão em Production/Preview; NEXT_PUBLIC_APP_URL de Production aponta à URL pública acima. O deploy veio da pasta local, sem commit/push.

O vínculo `.vercel/project.json` permanece em `cardapio-digital`. Este projeto usa `APP_SURFACE=admin`, `NEXT_PUBLIC_ADMIN_URL=https://cardapio-digital-sigma-ten.vercel.app` e `NEXT_PUBLIC_MENU_URL=https://cardapio-cliente-three.vercel.app`.

Para publicar o cliente sem alterar esse vínculo, use as variáveis de processo abaixo. O projeto público tem `APP_SURFACE=customer`, a origem administrativa e as mesmas três variáveis Supabase. As APIs de equipe retornam 404 nessa publicação.

```powershell
$env:VERCEL_PROJECT_ID = 'prj_fblGqEvBa78sBgAcVjnzzkoBKoBO'
$env:VERCEL_ORG_ID = 'team_rtfVwbf1pzgX89eOofZsWCbc'
npx vercel deploy --prod --yes --scope nutrivox
Remove-Item Env:VERCEL_PROJECT_ID
Remove-Item Env:VERCEL_ORG_ID
```

Supabase Auth Site URL está em produção; callbacks /app/aceitar-convite autorizados em produção e localhost 3000/3001. Para convites, configure SMTP próprio e valide uma entrega antes de usar e-mail. A criação com senha inicial funciona sem SMTP.

## Observações da revisão

- RLS nas 27 tabelas públicas (15 do MVP e 12 da Fase 2). Sessões/tentativas não concedem leitura direta ao cliente; as rotas do cliente anônimo usam RPCs com `app.actor = 'customer'`.
- Zero alertas em dependências de produção. O audit completo mantém alertas transitivos de ferramentas em braces ([advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)); o downgrade major sugerido não foi aplicado.
- O advisor mantém o aviso de proteção contra senhas vazadas, disponível no [plano Pro ou superior](https://supabase.com/docs/guides/auth/password-security). Senha mínima configurada: 12 caracteres.
- Pagamentos são registrados à mão pela equipe (forma e valor); fechamento da conta pelo celular, Pix, gateway de cobrança, PDV, impressão de comandas e delivery ficaram fora (Fase 3).
