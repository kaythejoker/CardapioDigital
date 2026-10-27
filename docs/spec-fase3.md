# Spec — Fase 3: lista de espera, bloqueios e idiomas

Escrita em 2026-10-26. Complementa a [spec do MVP](spec.md) e a [spec da Fase 2](spec-fase2.md): tudo que não está aqui continua valendo. "Outros idiomas" estava fora da Fase 2 e entra agora, a pedido do usuário.

## Decisões do usuário (26/10)

1. **Fila de espera** = lista de espera por mesa: o salão cadastra quem chegou sem mesa e cada grupo recebe um número de ordem do dia. O cliente acompanha a posição pelo celular.
2. **Bloqueios** nos três níveis: pausar novos pedidos do restaurante, bloquear uma mesa/comanda e bloquear prato ou categoria com motivo e janela de horário.
3. **Idiomas** português, inglês e espanhol no cardápio do cliente **e** nos painéis da equipe, com nome e descrição dos itens por idioma.
4. **Módulos por plano**: as três funções viram módulos (`waitlist`, `order_blocks`, `languages`). Os restaurantes que já existem ficam com tudo ligado; a revenda decide depois qual plano tem o quê.

## 1. Lista de espera (`waitlist`)

- Tabela `waitlist_entries`: nome, número de pessoas, telefone e observação opcionais, número do dia, status e um token público.
- **Número de ordem**: sequencial por restaurante e por dia (fuso `America/Sao_Paulo`), começando em 1. Nunca se repete no mesmo dia, mesmo depois de desistência.
- Status: `aguardando` → `chamado` → `sentado`; `desistiu` a qualquer momento antes de sentar. "Chamado" pode voltar a "aguardando". Sentado e desistiu são finais.
- **Sentar** escolhe uma mesa livre e abre a comanda dela na mesma ação (gera o PIN como hoje).
- Quem opera: garçom e gestor, no painel do salão, aba "Espera". Tempo real pelo Supabase Realtime.
- **Cliente**: ao cadastrar, o painel mostra um QR e o link `/{slug}/espera/{token}`. A página mostra o número, quantos grupos estão na frente e o status; quando chamado, destaca "Sua mesa está pronta". Atualiza sozinha. Com telefone, o garçom tem o botão "Avisar no WhatsApp" (link `wa.me` com a mensagem pronta; nada é enviado pelo sistema).
- O link vale por 12 horas.

## 2. Bloqueios (`order_blocks`)

- **Pausar pedidos do restaurante** (`restaurants.orders_paused` + motivo): o cardápio continua visível, mas o envio é recusado e o cliente vê o aviso com o motivo. Comandas abertas, chamadas e pagamentos seguem normais.
- **Bloquear mesa** (`tabs.orders_blocked` + motivo): só essa comanda deixa de enviar pedidos; o resto da mesa continua (PIN, chamar garçom, conta). O cliente vê "Novos pedidos desta mesa estão bloqueados. Chame o garçom".
- **Bloquear prato ou categoria** (`blocked` + motivo, `available_from`/`available_until`): além de "esgotado" e "inativo", que continuam iguais. Bloqueado aparece apagado no cardápio com o motivo; fora da janela de horário aparece com "Disponível das 11:00 às 15:00". Janela pode virar a meia-noite (ex.: 18:00–02:00).
- O servidor confere tudo no envio do pedido (gatilhos no banco); o cardápio só reflete.
- Permissão nova `block_orders` ("Pausar pedidos e bloquear mesas"): padrão ligado para gestor, garçom, cozinha e bar. Bloquear prato/categoria e definir horário usam a permissão `edit_menu`.
- Registro de operações: pedidos pausados/retomados, mesa bloqueada/desbloqueada.

## 3. Idiomas (`languages`)

- **Interface**: seletor PT/EN/ES no cardápio e em todos os painéis. A escolha fica salva no aparelho; sem escolha, segue o idioma do navegador (cai em português).
- **Cardápio**: nome e descrição do item, nome da categoria, dos grupos de adicionais e das opções ganham campos em inglês e espanhol (`translations` em JSON). Campo vazio mostra o português.
- **O que não traduz**: o pedido que chega na cozinha e no bar continua com o nome em português (é o que a equipe lê), assim como o histórico e o registro de operações.
- **Módulo**: com `languages` desligado, o cardápio do cliente fica só em português e o editor esconde os campos de tradução. O idioma dos painéis da equipe é preferência de cada pessoa e não depende do plano.

## 4. PIN da mesa opcional

Pedido do usuário em 26/10, para a fase de testes.

- `restaurants.pin_required`, ligado por padrão (nada muda para quem já usa). O gestor liga e desliga em Configurações → "PIN da mesa"; a mudança fica no registro de operações.
- Desligado, o cliente informa só o nome e entra na comanda. A mesa continua precisando de comanda aberta pelo garçom, e fechar a comanda continua derrubando as sessões. A trava de 5 tentativas só vale com PIN.
- O garçom continua vendo o PIN no salão; religar volta a exigir o código dos celulares novos (quem já entrou continua).

## Critérios de aceite

1. Dois grupos cadastrados no mesmo dia recebem 1 e 2; no dia seguinte, a contagem recomeça.
2. Sentar um grupo numa mesa livre abre a comanda; numa mesa ocupada, recusa.
3. A página do cliente mostra a posição certa e muda para "chamado" sem recarregar.
4. Com pedidos pausados, o envio é recusado no servidor com o motivo; retomar volta a aceitar.
5. Mesa bloqueada não envia; outra mesa do mesmo restaurante envia.
6. Item ou categoria bloqueados, ou fora do horário, são recusados no servidor e aparecem indisponíveis no cardápio.
7. Cardápio em inglês mostra as traduções preenchidas e cai no português onde não há.
8. Painéis trocam de idioma sem recarregar e lembram a escolha.
9. Módulo desligado no plano: a função some do painel e a API recusa.
10. PIN desligado: o nome basta para entrar numa comanda aberta; mesa sem comanda continua fechada; religar volta a exigir o código.
