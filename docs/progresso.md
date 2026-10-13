# Progresso do MVP — atualizado em 2026-10-13

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
