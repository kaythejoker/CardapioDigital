# Melhorias do teste de ponta a ponta — piloto Arroba (12/11/2026)

Anotadas durante o teste em produção e implementadas no mesmo dia (exceto o item 3, que é dado da revenda).

Lembrete do usuário: o PIN só é pedido quando o cliente já montou o carrinho e vai enviar o pedido. Antes disso ele navega pelo cardápio e pode chamar o garçom sem PIN. Testes e roteiros devem seguir essa ordem.

## Cardápio do cliente

1. **"Minha comanda" visível** — feito. Era um texto sublinhado no fim da página, depois do rodapé. Agora é um botão fixo na base da tela, com ícone e a cor do restaurante, ao lado de "Chamar garçom" (aparece depois que o cliente entrou com nome/PIN).
2. **"Pedir a conta" na tela da comanda** — feito. Botão principal acima de "Pedir mais". Depois de pedir, vira "Conta pedida" (desativado) e aparece o aviso "Avisamos o garçom…". Fica desativado com a mesa já paga. Continua também em "Chamar garçom".
3. **Marca "Comanda" no rodapé ("Por Comanda") e na Ajuda** — pendente, é dado: trocar o nome da marca para "MesaClick" em Revenda → Marca (conta da revenda). O suporte por WhatsApp (5531984131529) aparece só nos painéis da equipe; o cliente não vê esse número.

## Painéis da equipe

4. **Alerta sonoro** — feito (`lib/alerts.ts`). Pedido novo, pedido pronto e chamada do garçom tocam por ~10 s, com volume 0,8 (era 0,35 e ~0,5 s). Atraso continua um toque só e não interrompe outro alerta. Qualquer toque ou tecla no painel para o som. Toca na hora mesmo com a aba em segundo plano (antes ficava guardado até voltar para a aba, por isso a primeira chamada do teste não tocou). "Ativar som" toca só um bipe de teste.
5. **Plural no Salão** — feito: "1 pedido pronto" e "1 pedido na comanda".
6. **Divisão da conta depois de pagar a mesa inteira** — feito. Com a comanda quitada, cada pessoa aparece como "Pago" (Salão e celular), sem o botão "Registrar pagamento", e o aviso de fechamento não lista ninguém como devendo.

7. **Revenda com acesso a tudo** — pedido do usuário em 12/11. A conta da revenda opera Salão, Cozinha e Bar de todos os restaurantes ativos dela, sem precisar entrar na equipe: o banco passa a tratar a revenda como equipe completa (`private.is_member`, migration `20261112120000_revenda_opera_restaurantes.sql`) e os painéis mostram o seletor de restaurante (também aceitam `?restaurant_id=`). O gestor lista os restaurantes da revenda no seletor. Precisa da migration aplicada em produção antes do push.

## Verificação

Typecheck, lint, 30 testes unitários e build. Telas conferidas numa prévia local com os dados reais do cardápio do Arroba (comanda, conta pedida, mesa paga, Salão com plural e divisão). O som não foi ouvido aqui: conferir no próximo teste em produção.

# Pedidos dos sócios depois da publicação (13/11/2026)

Lista recebida em 13/11. O usuário aprovou as propostas no mesmo dia ("implementa tudo") e elas foram implementadas em seguida (ver "Como ficou" no fim).

**Ordem de publicação:** primeiro a migration `20261113120000_upsell_sobremesa_financeiro.sql` no Supabase de produção, depois o deploy pela Vercel CLI nos dois projetos. Sem a migration, o cardápio e os painéis pedem colunas que ainda não existem (`pairs`, `suggest_at_bill`) e deixam de carregar.

1. **Upsell (casar vendas: "cerveja que combina com tal porção")**
   - Hoje: não existe. O cardápio só tem "Destaques da casa".
   - Proposta: no gestor, cada prato ganha o campo "Combina com" (escolher até 3 itens). No detalhe do prato e logo depois de adicionar ao carrinho, o cliente vê "Combina com…" com botão de adicionar. Precisa de migration nova (tabela de pares de itens).
2. **Sugestão de sobremesa ao pedir a conta**
   - Hoje: "Pedir a conta" só avisa o garçom.
   - Proposta: ao tocar em "Pedir a conta", antes de confirmar, aparece "Que tal uma sobremesa?" com os itens da categoria marcada como sobremesa (o gestor escolhe a categoria). O cliente pode pedir ou seguir para a conta.
3. **Taxa de 10% só no fechamento**
   - Hoje: o celular mostra "Sua parte" já com a taxa e "Total da mesa … • inclui 10% de serviço" desde o primeiro pedido.
   - Proposta: enquanto a mesa está aberta, o cliente vê só o consumo. A taxa aparece quando ele pede a conta (ou o garçom inicia o fechamento) e no Salão, na hora de registrar o pagamento. O cálculo no banco não muda.
4. **Financeiro só com comandas pagas**
   - Hoje: "Vendido hoje" soma todos os pedidos do dia, mesmo de mesas abertas. "Recebido hoje" já soma só pagamentos.
   - Proposta: "Vendido hoje" passa a contar só comandas fechadas. Os pedidos de mesas abertas aparecem num número separado, "Em aberto agora", para não sumir do controle.
5. **Cabeçalho maior e em negrito**
   - Hoje: o nome do restaurante no topo do cardápio tem 38 px (45 px no tablet), peso 650.
   - Proposta: nome em negrito (peso 800), cerca de 44 px no celular, com sombra leve para ler melhor sobre a foto. Os títulos das categorias também ficam mais fortes.
6. **Logo do Arroba com mais destaque**
   - Hoje: a logo aparece com 40 px acima do nome.
   - Proposta: logo com cerca de 88 px, num fundo claro arredondado, e banner um pouco mais alto.

## Como ficou (13/11/2026)

1. **Combina com** — coluna `menu_items.pairs` (até 3 itens; um gatilho tira o próprio prato, os repetidos e os itens de outro restaurante). No gestor, editor do item → "Combina com" (3 listas). No celular, depois de pôr um prato novo no carrinho, abre "Combina com {prato}" com botão "Adicionar" (item com escolha obrigatória abre o detalhe). Item bloqueado, fora do horário ou sem estoque não é sugerido.
2. **Sobremesa** — coluna `categories.suggest_at_bill`, marcada no gestor na linha da categoria ("Sugerir ao pedir a conta"). Ao tocar em "Pedir a conta" (comanda ou "Chamar garçom"), aparece "Que tal uma sobremesa antes de fechar?" uma vez por visita: "Adicionar" põe no carrinho e mostra "Ver carrinho e pedir"; "Não, quero a conta" avisa o garçom. Sem categoria marcada, segue direto como antes. **Falta o gestor do Arroba marcar a categoria de sobremesas.**
3. **Taxa só no fechamento** — com a mesa aberta, "Total da mesa" mostra só o consumo. Depois que alguém pede a conta (ou já houve pagamento), mostra o total com "com 10% de serviço (R$ …)". O banco e o Salão não mudam.
4. **Financeiro** — "Vendido hoje" soma o consumo das comandas fechadas hoje; o detalhe mostra quantas e quanto está em mesas abertas. O "Fechar o dia" grava o vendido do mesmo jeito (`close_day`).
5. **Cabeçalho** — nome do restaurante em peso 800, 44 px no celular (54 px no tablet), com sombra sobre a foto; títulos das categorias em negrito.
6. **Logo** — 88 px (108 px no tablet) num fundo claro arredondado; o banner cresce para caber.

Verificação: typecheck, lint, 30 testes unitários, build e `npm run db:check` com 325 verificações (inclui limpeza do "Combina com", limite de 3, revenda editando e fechamento do dia sem contar mesa aberta). As telas novas não foram vistas no navegador: este PC não tem `.env.local`.
