# Progresso do MVP — atualizado em 2026-10-21

## Fase 2 (spec-fase2.md) — concluída em 21/10/2026

Aprovada pelo usuário em 20/10 com as 9 decisões propostas. Cada etapa termina com typecheck, lint, `db:check`, testes unitários, E2E local, migration aplicada e deploy de produção dos dois projetos Vercel. Os dados dos sócios (`brasa-demo`) não são tocados; os testes criam e apagam registros próprios no Brasa Bistrô do seed.

- **20/10, antes da etapa 1:** o projeto Supabase estava pausado (`INACTIVE`, free tier sem uso por uma semana) e a produção estava fora do ar. Religado pela Management API (`POST /v1/projects/{ref}/restore`), sem perda de dados. Se voltar a pausar, repetir o restore antes de qualquer deploy.

### Etapa 1 — base (20/10)

- Migrations `20261020120000_papel_bar`, `20261020120100_base_fase2` e `20261020120200_corrigir_registro_cascata`: papel `bar`; `restaurant_members.roles` (vários papéis), `permissions` (ajuste por pessoa) e `active`; `role` continua em sincronia por trigger para o app antigo. `audit_log` escrito por triggers em tabs, orders, tab_guests, menu_items e restaurant_members, com o autor (equipe pelo `auth.uid()`, cliente pelo `app.actor` das RPCs). Permissões conferidas no banco: fechar comanda, cancelar pedido, registrar pagamento, editar cardápio (`can_edit_menu`). Quem é desligado some do restaurante. Ninguém altera o próprio vínculo; só a revenda mexe em gestores.
- `lib/permissions.ts` espelha os padrões do banco (gestor tudo; garçom cancelar, pagar, fechar e unir; cozinha e bar nada). Painel do gestor abre para quem tem permissão de gestão (cardápio, estoque, relatórios, financeiro), com só as telas permitidas.
- Equipe: papéis em caixas de seleção, permissões por pessoa, desligar acesso. Salão esconde o que a pessoa não pode fazer.
- Bug achado pela E2E: apagar um restaurante disparava o registro de "membro removido" em cascata e violava a chave estrangeira; corrigido na terceira migration (o registro ignora restaurante inexistente).
- Validação: typecheck, lint, 117 verificações no `db:check`, 13 unitários, 4 E2E locais. Publicado em 20/10.
- O navegador embutido do app de desenvolvimento não hidrata a página `/app/gestor` (fica em "Carregando seu restaurante…"); no Chromium do Playwright e em produção funciona. Verificações visuais do gestor passam a ser feitas por capturas via Playwright (`tmp/*.mjs`).

### Etapa 2 — cancelamento por item e estoque (21/10)

- Migration `20261021100000_cancelamento_itens_estoque`: `order_items.cancelled_at/by/reason`, `orders.cancelled_by/reason`; total do pedido recalculado pelos itens ativos (trigger), pedido vira cancelado quando o último item é cancelado, cancelar o pedido inteiro cancela os itens. Estoque por item (`stock_enabled`, `stock_quantity`, `low_stock_threshold`, `sold_out_auto`), `stock_movements`, baixa na transação do pedido com a mensagem "Restam N unidades de X", devolução no cancelamento, esgotado automático em zero e reposição que desmarca. RPCs `cancel_order_item` (equipe, com permissão `cancel_items`), `cancel_table_order_item` (cliente, pedido recebido) e `adjust_stock` (`manage_stock`).
- Cliente: "Cancelar item" na comanda, item cancelado riscado, aviso "Últimas N unidades" e quantidade limitada ao saldo. Garçom: "Cancelar" por item e por pedido com motivo (lista + detalhe). Cozinha: item cancelado riscado no card; esgotados mostram o saldo. Gestor: tela **Estoque** (saldo, alerta, Repor, Ajustar, histórico) e estoque no editor do item.
- Validação: 141 verificações no `db:check`, 15 unitários, E2E nova `tests/e2e/stock-cancel.spec.ts` (estoque, cancelamento pelo cliente e pelo garçom, reposição, movimentos e registro) aprovada. Publicado em 21/10.

### Etapa 3 — alertas e chamadas (21/10)

- Migrations `20261021110000_chamadas` e `20261021110100_corrigir_expiracao_chamadas`: `service_calls` (garcom | conta | ajuda; aberta → atendida | expirada | cancelada), uma aberta por mesa e tipo, RPCs `create_service_call` (sem PIN só "garcom", 1 a cada 2 min por aparelho; com PIN liga à comanda e à pessoa), `cancel_service_call` (mesmo aparelho ou mesma comanda) e `expire_service_calls` (30 min, chamada ao carregar o painel; o guard aceita porque o servidor se marca como `system`). Fechar a comanda encerra as chamadas da mesa. Tabela na publicação do Realtime; tudo no `audit_log` com o tempo de atendimento.
- `lib/alerts.ts`: sons sintetizados no navegador (pedido novo, pronto, chamada, atraso), vibração, "Ativar som" lembrado por aparelho, um toque por evento, pendência tocada uma vez ao voltar do segundo plano; `(N)` no título da aba. Cozinha: card novo destacado por 10 s, som de atraso uma vez por pedido. Garçom: som e vibração em pedido pronto e chamada, contador de chamadas, filtro "Chamadas", mesa com "Chamando"/"Pede a conta", botão "Atendida" no detalhe; indicador "Ao vivo" também no salão.
- Cliente: botão flutuante "Chamar garçom" (mesa livre: "Chamar garçom para abrir a mesa", sem PIN); folha com Chamar garçom, Pedir a conta e Outro (texto até 80); aviso "Avisamos o garçom…" com "Cancelar chamada"; "Pedir a conta" só avisa, nada fecha.
- Validação: 136 verificações no `db:check`, 15 unitários, E2E nova `tests/e2e/calls-alerts.spec.ts` (chamada sem PIN em 2,7 s no garçom, cancelamento, pedir a conta com comanda aberta, atendimento e registro). Publicado em 21/10.

### Etapa 4 — painel do bar (21/10)

- Migration `20261021120000_bar`: `categories.station` (cozinha | bar, padrão cozinha), `menu_items.station` (sobrescreve), `orders.station` e `orders.batch_id`, `order_items.station`. `submit_table_order` separa o carrinho em um pedido por setor no mesmo `batch_id` (retry devolve o mesmo envio; `request_id` passa a ser único por setor). `private.item_station` resolve o setor efetivo. O registro de pedidos guarda o setor.
- `/app/bar`: o mesmo KDS da cozinha filtrado pelo setor (fila, esgotados, alertas, título "Fila do bar"), com visual roxo-escuro; papel `bar` e gestor abrem. Hub e atalhos do gestor ganham o Bar. Gestor: setor na categoria e no item ("Herdar da categoria"), painel "Fila do bar" na visão geral quando há itens do bar. Garçom: etiqueta Cozinha/Bar nos pedidos de um envio dividido. Cliente: vê um pedido só por envio, com "Cozinha: … • Bar: …" quando os dois setores participam; cancelar o pedido cancela os dois.
- Validação: 146 verificações no `db:check`, 15 unitários, E2E nova `tests/e2e/bar.spec.ts` (prato na cozinha, bebida no bar, esgotados por setor, status por setor no cliente). Publicado em 21/10.

### Etapa 5 — unir mesas (21/10)

- Migration `20261021130000_unir_mesas`: `tab_tables` (mesas unidas a uma comanda, com `released_at`; uma mesa em uma comanda aberta por vez), `tabs.merged_into`, `public.tab_for_table` (comanda aberta de uma mesa, principal ou unida), RPCs `merge_table` (mesa livre entra na comanda; mesa com comanda aberta tem pedidos, pessoas e chamadas movidos para a comanda alvo, a segunda fecha como unida e perde as sessões; nome repetido vira "Nome (mesa X)") e `split_table`. `open_table` recusa mesa unida; fechar a comanda libera as mesas. Todas as RPCs do cliente aceitam o QR de qualquer mesa da comanda (`private.session_tab`). Guards de pedidos, pessoas e chamadas deixam passar a movimentação (`app.merge`); a chave `orders_guest_fkey` virou adiável.
- Garçom: no detalhe da mesa, "Mesas desta comanda" com a principal e as unidas ("Separar"), "Unir mesa" com mesas livres e mesas com comanda aberta (com aviso); título "Mesas 12 + 13"; mesa unida aparece no mapa tracejada com "Unida à mesa 12". Cozinha e bar mostram "Mesa 12+13". Gestor: ocupação conta mesas unidas.
- Validação: 165 verificações no `db:check`, E2E nova `tests/e2e/merge-tables.spec.ts` (une comanda aberta, pedido e pessoa passam, sessão antiga cai, QR da mesa unida aceita o PIN da comanda, separar libera, registro). Publicado em 21/10.

### Etapa 6 — financeiro (21/10)

- Migration `20261021140000_financeiro`: `payments` (pessoa ou mesa; pix, dinheiro, débito, crédito, outro; estorno marca `voided_at`), `cash_closures` (um por dia e restaurante), taxa de serviço no restaurante (`service_fee_percent`, `service_fee_optional`) copiada para a comanda ao abrir, `service_fee_waived`, `discount_cents`/`discount_reason` e `closed_by` em `tabs`. `public.tab_totals` calcula itens, taxa, desconto, total, pago e saldo; `tab_guests.paid_cents` passa a ser mantido pelos pagamentos da pessoa (o "Marcar pago" direto foi removido). RPCs `register_payment`, `void_payment` (comanda fechada ou dia fechado: só gestor), `apply_discount` (permissão + motivo, não passa dos itens), `set_service_fee` (opcional ou com permissão de desconto) e `close_day` (totais do dia no fuso de São Paulo, por forma de pagamento). **Fechar a comanda pela equipe exige saldo quitado** ("Faltam R$ X"); o servidor (service role) continua fechando sem essa trava. Unir comandas também move pagamentos.
- Garçom: bloco de totais (itens, taxa com Retirar/Aplicar, desconto, total, pago, falta/troco), "Registrar pagamento" por pessoa ou da mesa (forma e valor pré-preenchido), lista de pagamentos com "Desfazer", desconto com motivo (permissão), fechamento bloqueado com saldo. Cliente: total da mesa com taxa, desconto e pago. Gestor: tela **Financeiro** (vendido, recebido por forma, taxa, descontos e cancelados; comandas fechadas hoje; "Fechar o dia" com observação; histórico de fechamentos) e taxa de serviço em Configurações.
- Validação: 190 verificações no `db:check`, E2E nova `tests/e2e/finance.spec.ts` (taxa copiada, retirar/aplicar, bloqueio sem pagamento, pix da pessoa + dinheiro da mesa, fechamento, Financeiro e fechamento do dia) e E2E de pedido ajustada para o novo pagamento. Publicado em 21/10.

### Etapa 7 — histórico, relatórios e satisfação (21/10)

- Migration `20261021150000_historico_relatorios_satisfacao`: `surveys` (uma por pessoa; nota 1–5, comida/atendimento/espera opcionais, etiquetas, comentário até 300) e `survey_invites` (ao fechar a comanda, o hash de cada sessão com nome vira convite de 24 h antes de a sessão ser apagada; comanda unida não gera convite); `restaurants.google_review_url` e `survey_enabled`. Funções no banco com a permissão conferida dentro: `report_summary` (por dia, hora, categoria, item, mesa, garçom, forma, cancelamentos por motivo e por papel, preparo por setor, ticket por comanda e por pessoa, tempo de mesa; até 12 meses), `survey_summary`, `restaurant_rating` (30 dias, revenda), `tab_history` (garçom só hoje), `tab_detail`, `audit_history`. Índices por `created_at`/`closed_at`.
- Cliente: ao fechar a comanda, a tela "Mesa fechada" vira a pesquisa (5 estrelas, notas rápidas, etiquetas, comentário, "Agora não"); nota 4–5 com link cadastrado mostra "Avaliar no Google". O mesmo celular continua sem conseguir pedir. Gestor: telas **Relatórios** (período + 9 tabelas, cada uma com "Exportar CSV" em UTF-8 com BOM e `;`), **Histórico** (comandas fechadas com filtro por mesa e detalhe completo; aba "Operações" com filtro por tipo) e **Satisfação** (médias, distribuição, taxa de resposta, etiquetas, comentários com nome e mesa, link para a comanda); pesquisa e link do Google em Configurações. Garçom: "Comandas fechadas hoje" somente leitura. Revenda: média de 30 dias por restaurante. Rotas `/api/history/[id]` e `/api/reports/[id]`.
- O cardápio do cliente passou a consultar o servidor a cada 5 s (era 8 s): o critério "esgotado some em até 10 s" ficava no limite e a E2E de segurança oscilou.
- Validação: 213 verificações no `db:check`, E2E nova `tests/e2e/history-survey.spec.ts` (pesquisa visível 2,6 s depois do fechamento, resposta única, Google, histórico, detalhe, operações, CSV com acentos, satisfação, garçom só hoje e sem relatórios). Publicado em 21/10.

### Etapa 8 — assinaturas, planos e suporte (21/10)

- Migration `20261021160000_assinaturas_suporte`: `plans` (preço, mensal/anual, limite de mesas, dias de teste, módulos `bar/stock/finance/reports/service_calls/surveys/custom_domain`, plano padrão por revenda), `subscriptions` (uma por restaurante; teste → ativa → atrasada → suspensa, derivado das datas na leitura, sem cron; carência padrão 5 dias) e `subscription_payments` (cobrança registrada à mão pela revenda; estende o vencimento e reativa). `public.restaurant_access` resume status, módulos e bloqueio; restaurante sem assinatura (legado) tem tudo liberado. Revenda nova nasce com o plano "Completo" padrão; restaurante novo nasce em teste; os existentes ficaram no Completo, ativos, sem vencimento. Contato de suporte em `resellers` (WhatsApp, e-mail, horário).
- Bloqueio e módulos no banco: suspenso recusa PIN, pedido e chamada; estoque, financeiro (fechar o dia), relatórios, pesquisa e bar (categoria/item) fora do plano respondem "Função não incluída no seu plano"; limite de mesas do plano na criação de mesa. Rotas: painel do gestor e do salão em modo leitura quando suspenso (403), módulo fora do plano 403.
- Revenda: tela **Planos** (criar/editar, módulos, padrão), em cada restaurante o status da assinatura, "Plano e status" (trocar plano, teste/ativa/suspensa/cancelada, vencimento, observação) e "Registrar pagamento"; cards com receita recorrente do mês, filtro por status e contagem em teste/pendência; suporte na tela Marca. Gestor e salão: faixa da assinatura (teste, atrasada, suspensa) e botão **Ajuda** (WhatsApp com mensagem pronta, e-mail, horário, 4 perguntas frequentes); telas de módulos fora do plano somem do menu. Cliente: "Cardápio temporariamente indisponível" quando suspenso.
- Validação: 238 verificações no `db:check`, E2E nova `tests/e2e/subscriptions.spec.ts` (plano sem estoque e bar, suspensão vista pelo cliente e pelo gestor em modo leitura, reativação, módulo 403, pagamento com vencimento, suporte no Ajuda). Publicado em 21/10.

### Etapa 9 — domínio próprio (21/10)

- Migration `20261021170000_dominio_proprio`: status de verificação do domínio da revenda (`domain_status`, `domain_checked_at`, `domain_error`), `restaurants.custom_domain` (único, validado, módulo `custom_domain` do plano; o gestor só mexe com o módulo), `public.resolve_host` (só o servidor) e triggers que voltam o status para "pendente" quando o domínio muda.
- `proxy.ts` resolve o `Host` que não é do projeto (cache de 60 s): domínio da revenda serve `/{slug}/m/{qr}`; domínio do restaurante serve `/` (cardápio para consulta, página nova `/[slug]/consulta`, sem mesa nem pedido) e `/m/{qr}` (mesa); outro slug dá 404; host desconhecido segue o fluxo normal; a URL da Vercel continua valendo (QR impressos). `lib/menu-origin.ts` escolhe o melhor endereço (restaurante > revenda > padrão): o PDF de QR, os links do painel e `menu_url` do `/api/menu` usam o domínio ativo.
- `/api/domains` registra, verifica e remove o domínio no projeto público pela API da Vercel (`lib/vercel-domains.ts`: `VERCEL_TOKEN`, `VERCEL_PROJECT_ID_MENU`, `VERCEL_TEAM_ID`), guarda o status e devolve as instruções de DNS (CNAME `cname.vercel-dns.com` para subdomínio, A `76.76.21.21` para apex, mais TXT de verificação quando a Vercel pede). Sem o token, as telas mostram as instruções e avisam que o registro automático está desligado. Telas: "Domínio da revenda" (Marca) e "Domínio próprio" (Configurações do gestor), com status, DNS, "Verificar agora". O painel da equipe continua na URL do projeto `cardapio-digital`.
- A API da Vercel foi exercitada com um domínio descartável (registrar → consultar → remover) usando o token do CLI só em memória; **em produção `VERCEL_TOKEN` ainda não está configurado** na Vercel — o usuário precisa criar um token de conta e cadastrá-lo nas variáveis do projeto `cardapio-digital`.
- Validação: 247 verificações no `db:check`, E2E nova `tests/e2e/domains.spec.ts` (host da revenda, raiz e `/m/{qr}` do restaurante, outro restaurante não abre, `menu_url` com domínio, URL antiga e host desconhecido). Publicado em 21/10.

### Etapa 10 — tempo real do cliente (21/10)

- Sem mudança no banco. `components/menu.tsx` ganhou o hook `usePolling`: a comanda da mesa consulta o servidor a cada 3 s enquanto está aberta e visível; o cardápio (status, esgotados, chamadas) a cada 5 s (a spec falava em 10 s, mas o critério "esgotado some em até 10 s" precisa da margem); as duas pausam quando a aba vai para segundo plano e atualizam na hora ao voltar (`visibilitychange` e `online`). Pedir, cancelar item ou pedido e chamar o garçom atualizam a tela na sequência, sem esperar o próximo ciclo.
- Rodapé da comanda "Atualizado agora" (`role="status"`, nome "Atualização da comanda"): vira "Atualizado há N s" se a consulta atrasar e "Sem conexão. Tentando atualizar sua comanda…" quando a rede cai.
- Validação: E2E nova `tests/e2e/realtime.spec.ts` com dois celulares na mesma mesa — cancelamento e pedido novo aparecem no outro celular em menos de 4 s (3 s de ciclo + resposta), nenhuma consulta durante 7 s com a aba oculta e consulta imediata ao voltar. `tests/e2e/order.spec.ts` passou a esperar a comanda constar como fechada antes de testar a revogação da sessão (corrida que apareceu na regressão da etapa 9). Publicado em 21/10.

### Etapa 11 — fechamento (21/10)

- E2E completo em produção (`QA_BASE_URL=https://cardapio-digital-sigma-ten.vercel.app`): 12 cenários passaram; o de domínio próprio fica `skip` fora do servidor local, porque o `Host` de teste nunca chega ao app pela Vercel. A primeira rodada mostrou 6 falhas que eram do ambiente de teste, não do produto: em produção o painel redireciona `/[slug]/m/[qr]` para o projeto público, e o cookie da sessão do cliente criado pela API no painel não valia no outro host. `tests/e2e/helpers.ts` (`customerOrigin`) segue esse redirecionamento e as specs passaram a chamar a API do cliente nessa origem.
- Documentação atualizada: `README.md` (estado, variáveis de domínio, cobertura dos E2E, observações), `AGENTS.md` (Fase 2 concluída, pendência do `VERCEL_TOKEN`), `docs/spec-fase2.md` (decisões confirmadas e ajustes feitos; 15 critérios de aceite marcados).
- Pendente do lado do usuário: criar um token de conta na Vercel e cadastrar `VERCEL_TOKEN`, `VERCEL_PROJECT_ID_MENU` e `VERCEL_TEAM_ID` no projeto `cardapio-digital` para o registro automático de domínios. Nada foi commitado nem enviado ao GitHub.

## Divisão da conta por pessoa — 2026-10-15

Pedido do usuário: todos da mesa usam o mesmo QR e o mesmo PIN, mas cada um entra com o próprio nome, vê os pedidos da mesa separados por pessoa e paga só a sua parte. Escolhas do usuário: todos veem a mesa inteira separada por pessoa; item pode ser marcado como "Dividir com a mesa"; o garçom marca quem já pagou. Juntar mesas ficou registrado na Fase 2 da spec.

- Migration `20261015120000_divisao_conta.sql`: tabela `tab_guests` (nome único por comanda, sem diferenciar maiúsculas; `paid_cents`/`paid_at`), `guest_id` em `tab_sessions` e `orders`, `shared` em `order_items`. RLS: equipe lê; só garçom e gestor registram pagamento, só com a comanda aberta, e não alteram o nome. `verify_table_pin` ganhou `p_name` opcional; `cancel_table_order` só cancela pedidos da própria pessoa.
- Compatível com a versão anterior: o banco aceita PIN sem nome; a API exige o nome, e sessões antigas sem nome pedem nome e PIN de novo. Pedidos antigos aparecem como "Sem nome".
- Regra de divisão em `lib/split.ts`: item dividido é repartido igualmente entre quem já estava na comanda no momento do pedido; centavos que sobram ficam com quem pediu. Se a pessoa pedir algo depois de marcada como paga, o saldo reabre.
- Cliente: nome na tela do PIN (lembrado no aparelho), opção "Dividir com a mesa" no carrinho e "Comanda da mesa" separada por pessoa, com "Sua parte" e total da mesa.
- Garçom: nome em cada pedido, seção "Divisão da conta" com "Marcar pago"/"desfazer" e aviso de quem ainda falta pagar ao fechar.
- Validação local: typecheck, lint, 10 testes unitários (6 novos da divisão) e `db:check` com 15 verificações novas.
- Publicado em 15/10: migration aplicada com `npm run db:deploy` (o script agora lê `SUPABASE_ACCESS_TOKEN` do `.env.local`, ignorado pelo Git e pela Vercel) e deploy de produção dos dois projetos Vercel. E2E de pedido e de segurança aprovados em produção; pedido visível na cozinha em 1220 ms. O E2E de gestão já falhava antes desta mudança porque procura o título "Bom dia, …", que saiu do painel do gestor no redesenho.

## Sincronização do repositório — 2026-10-13

As etapas 1–8 estão concluídas e publicadas, com o refinamento visual de 10/10. A implementação completa foi reunida em commit na branch `main` para disponibilização no remoto; até então, o Git continha apenas o setup (`0343caa`), enquanto a Vercel recebia deploys dos arquivos locais. Isso explicava a indicação de etapa inicial ao abrir o projeto em outro PC.

Esta sincronização inclui código, migrations, testes e documentação. Credenciais, `.vercel/`, artefatos em `output/` e relatórios temporários continuam fora do Git. Os dados e acessos da demonstração permanecem preservados. Ao configurar outra máquina, não repetir seed, reset ou implantação do banco já existente.

## Atualização V0 — 2026-10-10

### Refinamento dos painéis após envio aos sócios

- O usuário pediu para manter os dados enquanto os sócios testam. Não executar reset, seed, rotação de PIN, mudança de senha ou limpeza de pedidos nesta revisão.
- Refinamento visual isolado em `app/panels.css`, com navegação mais clara, contraste, formulários, resumo do gestor, cozinha e seleção dos painéis. Handlers de gravação, APIs, permissões e banco preservados.
- Atalho **Personalizar cardápio** no início do gestor abre Configurações. Identidade do restaurante aparece primeiro: nome em destaque no cardápio, logo, banner principal com prévia, cor e fundo. A prévia da capa usa a mesma foto exibida no cardápio público.
- Favicon próprio da Comanda em SVG, ICO (16/32/48 px) e ícone Apple (180 px), derivado do símbolo já usado na interface.
- Verificação visual de 14 telas/estados em desktop e celular, com escritas nas APIs de negócio bloqueadas durante a navegação. Build e lint aprovados; comparação dos 25 handlers de formulário confirmou preservação, e `components/operation.tsx` não foi alterado.

- Dois projetos publicados: painel em https://cardapio-digital-sigma-ten.vercel.app e cardápio público em https://cardapio-cliente-three.vercel.app. Mesmo repositório e Supabase autorizado; APIs administrativas bloqueadas no projeto público. O painel inclui links explícitos para a visão do cliente.
- Visual refeito a partir das sete referências: cardápio, detalhe, PIN, comanda e salão para celular; gestor com indicadores, gráfico e mapa; cozinha em duas colunas para desktop.
- Nome, logo, banner, cor principal e fundo editáveis por restaurante. Migration `20261010202953_personalizacao_restaurante.sql` aplicada; persistência e efeito no cardápio público verificados, com valores originais restaurados após o teste.
- PIN confirmado pelo usuário: único por comanda aberta, permite vários pedidos e perde validade ao fechar. QR fixo e exclusivo por mesa, gerado com a origem do projeto público.
- Conta `socios@comanda.dev` preparada no restaurante `brasa-demo`, com 23 itens, 12 mesas e pedidos fictícios. Acesso restrito a esse restaurante; senha local em `DEMO_USER_PASSWORD` e nos materiais privados de entrega.
- Validação após as mudanças: typecheck, lint, build, 54 verificações de banco e 4 cenários E2E em produção aprovados (51,1 s). Pedido apareceu na cozinha em 1179 ms; item esgotado saiu do cardápio em 8655 ms. Teste público também confirmou PIN, carrinho, adicionais e limites entre projetos.
- Entrega visual em `output/v0/`: 21 capturas de telas/estados, duas capturas de página completa, apresentação com 18 slides e PDF de QR codes das 12 mesas. Dados fictícios identificados na apresentação. Diretório ignorado pelo Git e pela Vercel.
- Em Windows/OneDrive, se o Playwright ignorar arquivos por atributos de reparse point, copiar os testes para uma pasta temporária e definir `QA_TEST_DIR`; a configuração suporta esse caminho sem alterar os testes.

O restante deste documento registra a entrega inicial de 09/10; as decisões acima prevalecem onde houver diferenças.

Objetivo autorizado: terminar a spec e publicar na Vercel da Nutrivox. O usuário autorizou o projeto `cardapio-digital` e escolheu acesso com senha inicial por enquanto, adiando SMTP para convites por e-mail. Não fazer commit ou push sem pedido.

## Entrega

- Produção: https://cardapio-digital-sigma-ten.vercel.app
- Vercel: https://vercel.com/nutrivox/cardapio-digital
- Supabase existente: `yekmailbymutimhmddzx`, Nutrivox, São Paulo. GrowthTracker não foi usado.
- Branch `main`, atualizada por fast-forward até `0343caa` antes da implementação. Deploy pela pasta local; mudanças ainda sem commit/push.
- Seis migrations aplicadas e registradas em `supabase_migrations.schema_migrations`. Bucket `restaurant-images` público para leitura, com escrita apenas pelas rotas autenticadas do servidor.
- Seed: 2 restaurantes, 16 mesas, 25 itens, 4 vínculos de equipe e 1 de revenda. Testes criam registros temporários e os removem ao terminar.
- `.env.local` contém credenciais e `SEED_USER_PASSWORD`, ignorado pelo Git e pela publicação. Token de gerenciamento não foi salvo no repositório.

## Telas da spec

| Telas | Implementação |
| --- | --- |
| 1–7, cliente | Cardápio com renderização inicial no servidor, fotos/capa/logo, categorias, busca, destaques, detalhe/adicionais, carrinho editável, PIN, confirmação, comanda e mesa fechada. |
| 8–10, garçom | Login, seleção de painel, mapa por status, PIN/rotação, pedidos, entrega, cancelamento e fechamento com confirmação. |
| 11–12, cozinha | KDS escuro, três prioridades, limite de espera, fixação, cronômetro, alerta de atraso, Iniciar/Pronto e esgotados. |
| 13–18, gestor | Indicadores do dia em São Paulo, mais pedidos, categorias/itens e ordenação por arraste ou teclado, editor com adicionais/upload, mesas/PDF A4, equipe e configurações. |
| 19–20, revenda | Criar/ativar/desativar restaurantes, criar gestor, contagem de ativos, nome/logo/cor/domínio da marca aplicado aos restaurantes. |

O domínio cadastrado na marca é um dado de configuração; um domínio personalizado precisa de DNS e vínculo na hospedagem. A URL Vercel publicada funciona. A contagem de ativos representa a situação atual do mês, conforme o modelo sem histórico de faturamento da spec.

## Critérios de aceite

| Critério | Evidência |
| --- | --- |
| Cardápio em menos de 2 s em 4G | Três aberturas em produção, Chromium com cache desativado, 9 Mbps download, 1,5 Mbps upload e 150 ms: busca funcional em 1955 / 1201 / 1139 ms. Imagens visíveis prontas em 1983 / 1230 / 1155 ms. Medição sintética; redes reais variam. |
| Sem PIN, nenhum pedido | E2E via API retorna 401 sem sessão; SQL/API validam sessão, mesa, restaurante e comanda. |
| Cinco erros bloqueiam cinco minutos | E2E confirma bloqueio inclusive com PIN correto; PGlite verifica liberação depois da expiração. |
| Pedido na cozinha em menos de 3 s | E2E em produção com contextos separados de cliente/garçom/cozinha: 1685 ms incluindo envio. |
| Três regras, limite e fixação | Unitários e E2E verificam ordem de chegada, complexidade, equilibrado, limite e fixação no KDS. |
| Fechamento invalida sessões | E2E verifica GET/POST negados após fechar; trigger apaga sessões e RPCs travam a comanda para evitar corrida. |
| Isolamento de restaurantes | PGlite com dois gestores e E2E de gestão cruzada negada (403); RLS nas 15 tabelas públicas. |
| Esgotado some em até 10 s | E2E em produção: 8600 ms. Servidor também recusa pedidos do item esgotado. |
| PDF pronto para impressão | Download real em produção, A4, 6 mesas/página, duas páginas inspecionadas. QR da mesa 1 decodificado com a URL pública correta. |

Validação: typecheck, lint, builds local e Vercel, db:check (54 verificações), 4 testes unitários e 4 cenários E2E. E2E inclui criação/remoção de garçom, upload reencodificado, adicionais obrigatórios, idempotência, preços do banco, snapshots e marca em dois restaurantes. As sete referências foram lidas; cardápio mobile, cozinha e PDF foram inspecionados visualmente.

## Segurança e decisões operacionais

- Cliente: cookie httpOnly, Secure em produção, SameSite=Lax; só hash no banco, validade 8h. PIN usa trava transacional por dispositivo/IP e restaurante.
- RPCs de PIN/pedido/cancelamento são SECURITY INVOKER, executáveis apenas por service_role. Papéis de equipe vêm dos vínculos, nunca de metadados do usuário.
- Preços e nomes vêm do banco e são preservados em snapshots. request_id evita pedidos duplicados em retry. Cancelamento atômico, permitido ao cliente somente em recebido.
- KDS autentica Realtime antes de assinar. Pedidos de comandas abertas são paginados, sem corte pelos 500 pedidos históricos mais recentes.
- Upload valida tipo/tamanho e reencoda para WebP. Segredos ficam no servidor; só URL/chave pública entram no navegador.
- Advisor: corrigida execução da função de plataforma rls_auto_enable. Restam dois INFO intencionais (sessões e tentativas sem leitura de cliente) e aviso de proteção contra senhas vazadas, recurso Pro do Supabase. Senha mínima: 12 caracteres.
- npm audit --omit=dev: zero vulnerabilidades. Audit completo: nove alertas de ferramentas de desenvolvimento derivados de braces <=3.0.3 (GHSA-vfj7-8cjw-p6xm), sem versão corrigida no levantamento. Não aplicar o downgrade incompatível proposto pelo npm.
- Auth Site URL e redirects apontam para produção/callbacks locais. Sem SMTP próprio; por decisão do usuário, o padrão é senha inicial. Convite por e-mail fica disponível para depois de configurar SMTP; entrega de e-mail não validada.
- Funções Vercel em gru1 (São Paulo); NEXT_PUBLIC_APP_URL de produção configurada para os QR codes.

Artefatos de QA em tmp/ e relatórios Playwright em test-results/, ambos ignorados. Consulte o README para executar, acessar e publicar.
