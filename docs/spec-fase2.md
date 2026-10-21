# Spec — Fase 2: completar a lista Mesa Click

Escrita em 2026-10-20 a partir da conferência da lista "Mesa Click" contra o app. Complementa a [spec do MVP](spec.md): tudo que não está aqui continua valendo como está lá. Esta fase cobre as 7 funções que faltam, ajusta 6 das 7 que estão parciais e acrescenta a pesquisa de satisfação do cliente, pedida em 20/10. O fechamento da conta pelo celular do cliente **não entra agora**: o cliente só avisa o garçom que quer fechar. As decisões marcadas com **(proposta)** precisam do seu ok antes de construir; o resto segue o que a spec do MVP já definia.

## Situação de partida

| Função da lista | Hoje | Nesta fase |
| --- | --- | --- |
| Notificações de novos pedidos (som e visual) | Só visual: pedido aparece na hora na cozinha, garçom vê "Prontos" | Som, vibração, contador e título da aba piscando |
| Suporte | Não existe | Botão "Ajuda" em todos os painéis com o contato da revenda |
| Cancelamento de itens | Cancela o pedido inteiro. Cliente cancela só com status "recebido"; garçom e gestor cancelam em qualquer status | Cancelar item por item, com motivo e registro |
| Unir as mesas | Não existe | Garçom une mesas numa comanda só |
| Controle de Estoque | Só "esgotado" manual | Quantidade por item, baixa automática e reposição |
| Controle Financeiro | Só ticket médio e pedidos do dia | Pagamento por forma, taxa de serviço, fechamento do dia |
| Domínio Próprio | Campo de texto na marca, sem efeito | Domínio da revenda funcionando de verdade, com instruções de DNS |
| Relatórios gerenciais | Só os números de hoje | Relatórios por período com exportação CSV |
| Painel da cozinha e do bar | Só cozinha | Painel do bar separado, item vai para o setor certo |
| Gestão de funcionários e permissões | Três papéis fixos: gestor, garçom, cozinha | Papel "bar", pessoa com mais de um papel e permissões ajustáveis |
| Histórico de pedidos e operações | Só pedidos de hoje e das comandas abertas | Comandas fechadas, filtros por data e mesa, registro de quem fez o quê |
| Chamar funcionário pelo celular | Não existe | "Chamar garçom" e "Pedir a conta" no cardápio |
| Fazer fechamento pelo celular | Só o garçom fecha | **Não entra agora.** O cliente só avisa que quer fechar ("Pedir a conta", seção 12); o fechamento continua com o garçom |
| Pesquisa de satisfação do cliente | Não existe | Avaliação no celular do cliente ao fechar a comanda, com envio para o Google quando a nota é boa (seção 15) |
| Gestão de assinaturas | Revenda ativa e desativa restaurantes | Planos, período de teste, cobrança registrada à mão e bloqueio por inadimplência |
| Conta compartilhada em tempo real | Atualiza a cada 10 segundos | Atualiza em até 3 segundos com a comanda aberta na tela |

## Decisões transversais

- **Registro de operações** (`audit_log`): toda ação relevante da equipe grava quem fez, o quê, em qual comanda ou item, e quando. É a base do histórico e passa a ser escrita pelas RPCs e rotas já existentes (abrir mesa, PIN novo, fechar comanda, marcar pago, esgotar item) e por todas as novas.
- **Módulos por plano.** A spec do MVP previa vender as fases como módulos. Cada plano liga ou desliga: bar, estoque, financeiro, relatórios, chamar garçom, pesquisa de satisfação e domínio próprio. Função desligada some do painel e a API recusa. Os restaurantes que já existem recebem o plano "Completo" com tudo ligado, para nada mudar para os sócios que estão testando.
- **Tempo real da equipe continua pelo Supabase Realtime**, respeitando RLS. As novas tabelas que a equipe acompanha ao vivo (`service_calls`, `tab_tables`, `payments`) entram na publicação do Realtime.
- **Nada muda no que está impresso.** QR codes já impressos continuam funcionando mesmo depois de domínio próprio e união de mesas.
- Todas as novas tabelas com `restaurant_id` recebem RLS igual às atuais. Valores em centavos, fuso `America/Sao_Paulo`, interface em português do Brasil.

## 1. Alertas sonoros e visuais

Para quem: cozinha, bar e garçom.

**O que acontece**

| Evento | Quem é avisado | Como |
| --- | --- | --- |
| Pedido novo chega | Cozinha ou bar do setor | Som curto, card entra destacado por 10 s, contador no título da aba: "(2) Fila da cozinha" |
| Pedido pronto | Garçom | Som, vibração no celular, mesa pisca no mapa, contador em "Prontos" |
| Cliente chama o garçom ou pede a conta | Garçom | Som diferente do de pedido pronto, vibração, badge na mesa |
| Pedido atrasado passa do limite | Cozinha ou bar | Som de alerta uma vez por pedido; o card já muda de cor hoje |

**Regras**

- Navegadores só tocam som depois de um toque do usuário. Cada painel mostra um botão "Ativar som" na primeira abertura; a escolha fica guardada no aparelho (`localStorage`) e um ícone no cabeçalho liga e desliga. Sem o toque, fica só o alerta visual.
- Volume e tipo de som não são configuráveis nesta fase; três sons curtos embutidos no app (pedido novo, pronto, chamada), sem arquivos externos.
- Vibração só onde o navegador permite (`navigator.vibrate`); falha em silêncio.
- Som nunca repete em loop: um toque por evento. Pedidos que chegam enquanto a aba está em segundo plano tocam ao voltar, uma vez só.
- Sem notificações push fora do navegador (precisam de service worker e permissão do sistema); fica para a Fase 3.

## 2. Suporte

Para quem: gestor, garçom, cozinha e bar pedem ajuda à revenda.

- A revenda cadastra na tela **Marca**: WhatsApp de suporte, e-mail de suporte e horário de atendimento (texto livre). Campos novos em `resellers`: `support_whatsapp`, `support_email`, `support_hours`.
- Todo painel ganha um botão "Ajuda" no menu. Ele abre uma folha com: nome da marca, botão "Falar no WhatsApp" (link `wa.me` com mensagem pronta contendo nome do restaurante e painel), e-mail, horário e três ou quatro perguntas frequentes fixas (abrir mesa, PIN, esgotado, fechar comanda).
- O cliente não tem suporte da revenda: o botão dele é "Chamar garçom" (seção 12).
- **(proposta)** Sem sistema de chamados nesta fase: o contato é direto pelo WhatsApp da revenda. Se o Felipe quiser fila de chamados dentro do painel, entra como módulo depois.

## 3. Cancelamento de itens

Para quem: cliente, garçom, gestor.

**Modelo**

- `order_items` ganha `cancelled_at`, `cancelled_by` (uuid ou nulo para o cliente), `cancel_reason` (texto curto, opcional).
- `orders.total_cents` passa a ser a soma dos itens não cancelados; o banco recalcula por trigger.
- `orders` ganha `cancelled_by` e `cancel_reason` para o cancelamento do pedido inteiro, que continua existindo.

**Regras**

- Cliente cancela um item só enquanto o pedido está `recebido`, e só nos próprios pedidos. Sem motivo.
- Garçom e gestor cancelam item em `recebido`, `em_preparo` ou `pronto`, com motivo escolhido de uma lista (cliente desistiu, saiu errado, item acabou, outro) e texto opcional. Em `entregue` não cancela; o ajuste é financeiro (desconto, seção 6).
- Quando o último item de um pedido é cancelado, o pedido vira `cancelado` automaticamente.
- Cancelar item em `em_preparo` avisa a cozinha ou o bar: o item aparece riscado no card por 30 s com som de alerta.
- Item cancelado some da divisão da conta e da parte de cada pessoa; devolve a quantidade ao estoque (seção 5).
- Tudo grava em `audit_log`.

**Telas**

- Cliente, em "Comanda da mesa": cada item do próprio pedido `recebido` tem "Cancelar item".
- Garçom, no detalhe da mesa: cada item tem "Cancelar" que abre a lista de motivos. "Cancelar pedido" continua existindo.

## 4. Unir mesas

Para quem: garçom e gestor.

**Modelo**

- Nova tabela `tab_tables (tab_id, table_id, restaurant_id, added_at, added_by)`: todas as mesas de uma comanda. `tabs.table_id` continua sendo a mesa principal (a que abriu).
- Índice único: uma mesa só pode estar em uma comanda aberta, seja como principal ou unida. Substitui o índice atual "uma comanda aberta por mesa".
- O QR de qualquer mesa da comanda leva à mesma comanda e aceita o mesmo PIN.

**Regras**

- Unir mesa **livre** a uma comanda aberta: a mesa entra na comanda na hora, sem PIN novo.
- Unir duas comandas **abertas** **(proposta)**: os pedidos, pessoas e pagamentos da segunda passam para a primeira; a segunda fecha como "unida"; o PIN que vale é o da primeira; os celulares da segunda precisam digitar o PIN de novo (as sessões dela são invalidadas, como já acontece ao fechar).
- Separar: o garçom pode tirar uma mesa unida da comanda enquanto ela estiver aberta; a mesa volta a ficar livre. Os pedidos ficam todos na comanda; não há "desfazer" que devolva pedidos para a mesa separada.
- Fechar a comanda libera todas as mesas dela de uma vez.
- Nas telas, a comanda aparece como "Mesas 12 + 13"; no mapa, as mesas unidas ficam com a mesma cor e um ícone de elo. Cozinha e bar mostram "Mesa 12+13" no card.

**Telas**

- Detalhe da mesa (garçom): botão "Unir mesa" abre a lista de mesas livres e de mesas ocupadas (com aviso do que acontece). Lista das mesas da comanda com "Separar" em cada uma, exceto a principal.

## 5. Controle de estoque

Para quem: gestor controla; cozinha e bar continuam marcando esgotado à mão.

**Modelo**

- `menu_items` ganha `stock_enabled` (padrão falso), `stock_quantity` (inteiro, nulo quando desligado) e `low_stock_threshold` (padrão 5).
- Nova tabela `stock_movements (id, restaurant_id, menu_item_id, kind entrada|venda|cancelamento|ajuste, quantity, balance_after, order_item_id, created_by, note, created_at)`.

**Regras**

- Estoque é por item do cardápio, em unidades vendidas. Não há ficha técnica, insumos nem receitas; isso fica fora desta fase.
- Com `stock_enabled`, cada item pedido baixa a quantidade na hora do envio, dentro da mesma transação do pedido; cancelar o item devolve. Pedido com quantidade maior que o saldo é recusado com a mensagem "Restam 2 unidades de X".
- Saldo em zero marca `sold_out` automaticamente e o item some do cardápio em até 10 s, como já acontece. Reposição com saldo maior que zero tira o `sold_out` automático; o esgotado marcado à mão pela cozinha continua valendo até alguém desmarcar.
- Abaixo do limite, o item aparece com aviso "Estoque baixo" no cardápio do gestor e na lista de esgotados da cozinha e do bar.
- Adicionais (modifiers) não têm estoque nesta fase.

**Telas**

- Editar item: chave "Controlar estoque", quantidade atual, limite de alerta.
- Nova tela do gestor **Estoque**: lista dos itens com estoque ligado, saldo, alerta, botão "Repor" (quantidade e observação) e "Ajustar" (saldo correto e motivo). Histórico de movimentos por item.

## 6. Controle financeiro

Para quem: garçom registra; gestor acompanha e fecha o dia.

**Modelo**

- Nova tabela `payments (id, restaurant_id, tab_id, guest_id nulo quando é a mesa toda, method pix|dinheiro|debito|credito|outro, amount_cents, received_by, created_at, voided_at, voided_by)`. Substitui o `paid_cents` atual: a marcação "pago" passa a ser um pagamento registrado; `paid_cents` vira coluna calculada a partir dos pagamentos, para não quebrar o que já existe.
- `tabs` ganha `service_fee_percent` (copiado da configuração do restaurante ao abrir), `discount_cents`, `discount_reason`, `closed_by`.
- `restaurants` ganha `service_fee_percent` (padrão 0, máximo 20) e `service_fee_optional` (padrão verdadeiro).
- Nova tabela `cash_closures (id, restaurant_id, day, opened_at, closed_at, closed_by, totals jsonb, note)`: o fechamento do dia.

**Regras**

- **Taxa de serviço (proposta):** o gestor define o percentual (0 desliga). Quando ligada, aparece na comanda do cliente e do garçom como linha separada; se "opcional", o garçom pode retirar na hora de fechar com um toque. Resolve a pergunta em aberto da spec do MVP.
- **Desconto (proposta):** só gestor, ou garçom com a permissão "aplicar desconto" (seção 10). Valor em reais ou percentual, com motivo obrigatório. Não há cupom.
- Registrar pagamento: por pessoa ou pela mesa toda, com forma e valor. Vários pagamentos por comanda são permitidos (metade Pix, metade dinheiro). Pagamento registrado errado é estornado ("Desfazer", com registro), não apagado.
- Fechar comanda exige total pago maior ou igual ao total devido (itens não cancelados + taxa − desconto); o app mostra quanto falta e de quem. Troco é só informativo para dinheiro.
- Fechamento do dia: o gestor confere o resumo (vendas, por forma de pagamento, taxa de serviço, descontos, cancelamentos, comandas abertas pendentes) e fecha. Comandas abertas não impedem o fechamento, mas aparecem como pendência. Dia fechado não aceita mais estorno sem o gestor.
- Fora desta fase: despesas, contas a pagar, fluxo de caixa, conciliação bancária, nota fiscal, integração com maquininha ou gateway. Pagamento pelo app (Pix) é Fase 3.

**Telas**

- Garçom, detalhe da mesa: a seção "Divisão da conta" ganha "Registrar pagamento" (forma, valor, pessoa ou mesa), linha de taxa de serviço com "Retirar", e desconto quando tiver permissão.
- Gestor, nova tela **Financeiro**: hoje em cima (vendido, recebido por forma, taxa, descontos, cancelado), lista de comandas do dia com valor e forma, botão "Fechar o dia", histórico de fechamentos.
- Gestor, Configurações: taxa de serviço e se é opcional.

## 7. Domínio próprio

Para quem: revenda, e opcionalmente cada restaurante.

**Como funciona**

- A revenda cadastra o domínio (ex.: `cardapio.marcadofelipe.com.br`) na tela Marca. O app registra o domínio no projeto Vercel do cardápio público pela API da Vercel (token `VERCEL_TOKEN` e `VERCEL_PROJECT_ID_MENU` só no servidor) e mostra na tela o que apontar no DNS (CNAME) e o status: aguardando DNS, verificando, ativo, erro.
- `proxy.ts` resolve o restaurante pelo cabeçalho `Host`: domínio da revenda serve `/{slug}/m/{qr}` de todos os restaurantes dela; a URL atual da Vercel continua funcionando para sempre, então os QR impressos não quebram.
- QR codes gerados depois do domínio ativo usam o domínio. Os anteriores seguem válidos pela URL antiga.
- **(proposta)** Domínio por restaurante (`restaurants.custom_domain`, ex.: `cardapio.brasabistro.com.br`) entra como módulo do plano: a raiz do domínio abre o cardápio do restaurante em modo consulta, e `/m/{qr}` abre a mesa. Mesmo fluxo de DNS.
- O painel da equipe continua na URL do projeto `cardapio-digital`; domínio para o painel não entra nesta fase.
- Certificado HTTPS é automático pela Vercel. Se a API da Vercel falhar, a tela mostra o erro e deixa tentar de novo; nada fica meio configurado no banco.

## 8. Relatórios gerenciais

Para quem: gestor (e revenda, só a contagem de restaurantes, como hoje).

- Período: hoje, ontem, 7 dias, 30 dias, mês atual, mês anterior, intervalo livre (máximo 12 meses).
- Relatórios: vendas por dia, por hora, por categoria, por item (quantidade e valor), por mesa, por garçom (quem abriu e fechou), formas de pagamento, taxa de serviço e descontos, cancelamentos (itens, motivos, quem cancelou), ticket médio por comanda e por pessoa, tempo médio de preparo por setor, tempo médio de mesa ocupada.
- Cada relatório tem "Exportar CSV" (UTF-8 com BOM, separador ponto e vírgula, para abrir direto no Excel em português).
- Os números vêm de consultas no servidor com paginação; a página do gestor deixa de carregar os 500 pedidos mais recentes e passa a pedir só o período. Índices em `orders (restaurant_id, created_at)` e `payments (restaurant_id, created_at)`.
- Sem gráficos novos além dos que o painel já tem; tabelas com totais no rodapé. Resumo semanal no WhatsApp do dono continua na Fase 2 da spec original, mas fora desta entrega.

## 9. Painel do bar

Para quem: bar, cozinha, garçom, cliente.

**Modelo**

- `categories` ganha `station cozinha|bar` (padrão cozinha). `menu_items` ganha `station` nulo, que herda da categoria e pode sobrescrever.
- `orders` ganha `station` e `batch_id`. **(proposta)** Ao enviar, o servidor separa o carrinho em um pedido por setor, ligados pelo mesmo `batch_id`. Assim a máquina de status, a fila com prioridade, o atraso e o cancelamento continuam funcionando sem mudança por setor.
- `order_items.station` guarda o setor no momento do pedido (snapshot).
- Novo papel `bar` em `restaurant_members.role`.

**Regras**

- Cliente vê o envio como um pedido só, com status por setor quando houver os dois: "Cozinha: em preparo • Bar: pronto". O garçom também.
- A fila do bar usa as mesmas três regras e o mesmo limite de espera da cozinha; **(proposta)** sem configuração separada nesta fase.
- Esgotados: cada painel só mostra os itens do seu setor.
- Restaurante sem itens no bar não vê o painel do bar: o módulo fica desligado no plano ou simplesmente sem uso.

**Telas**

- `/app/bar`: a mesma tela da cozinha (tema escuro, Iniciar, Pronto, fixar, esgotados), filtrada pelo setor bar.
- Gestor, cardápio: setor na categoria e no item. Resumo do painel ganha "Fila do bar" ao lado de "Fila da cozinha" quando o bar existe.

## 10. Funcionários e permissões

Para quem: gestor (e revenda para o gestor).

**Modelo**

- `restaurant_members` passa a aceitar mais de um papel por pessoa: `roles member_role[]` substitui `role`. Papéis: gestor, garçom, cozinha, bar.
- `restaurant_members.permissions jsonb` com chaves: `cancel_items`, `apply_discount`, `register_payment`, `close_tab`, `merge_tables`, `view_reports`, `view_finance`, `edit_menu`, `manage_stock`. Cada papel tem um padrão (garçom: cancelar, registrar pagamento, fechar, unir; cozinha e bar: nada disso; gestor: tudo) e o gestor liga ou desliga por pessoa.
- `restaurant_members.active` para desligar alguém sem apagar o histórico do que ela fez.

**Regras**

- A permissão vale no servidor: RLS e rotas conferem a chave, não só a tela.
- Gestor não tira as próprias permissões nem se remove; a revenda faz isso.
- A tela de equipe mostra papéis e permissões por pessoa, com os padrões já marcados ao escolher o papel.

## 11. Histórico de pedidos e operações

Para quem: gestor; garçom vê só o dia atual.

**Modelo**

- Nova tabela `audit_log (id, restaurant_id, actor_id, actor_role, action, entity, entity_id, tab_id, data jsonb, created_at)`. Ações: abrir mesa, PIN novo, unir e separar mesa, pedido enviado, item cancelado, pedido cancelado, status alterado, pagamento registrado e estornado, desconto, taxa retirada, comanda fechada, item esgotado e reposto, estoque reposto e ajustado, preço alterado, membro adicionado, removido e permissões alteradas, dia fechado.
- Só inserção; ninguém edita nem apaga. RLS: equipe lê o do próprio restaurante.
- **(proposta)** Retenção: 12 meses visíveis no painel; o dado continua no banco.

**Telas**

- Gestor, nova tela **Histórico**: comandas fechadas com filtros por data, mesa, garçom e valor; detalhe da comanda com pessoas, pedidos, itens (inclusive cancelados, com motivo), pagamentos, taxa, desconto, quem abriu e fechou, mesas unidas. Aba "Operações" com a linha do tempo do `audit_log` filtrável por tipo e pessoa.
- Garçom: no mapa de mesas, "Comandas fechadas hoje" com o detalhe, somente leitura.

## 12. Chamar funcionário e pedir a conta

Para quem: cliente chama; garçom atende.

**Modelo**

- Nova tabela `service_calls (id, restaurant_id, table_id, tab_id nulo quando a mesa está livre, guest_id, kind garcom|conta|ajuda, note, status aberta|atendida|expirada, created_at, attended_by, attended_at)`.

**Regras**

- Com a comanda aberta e o PIN já digitado, o cliente tem no rodapé do cardápio o botão "Chamar garçom" com três opções: Chamar garçom, Pedir a conta, Outro (texto de até 80 caracteres).
- Com a mesa livre, o botão é "Chamar garçom para abrir a mesa", sem PIN, limitado a uma chamada a cada 2 minutos por aparelho, para evitar abuso de quem só escaneou o QR.
- Uma chamada aberta por mesa e tipo; chamar de novo mostra "Já avisamos, o garçom está a caminho" com o tempo decorrido. O cliente pode cancelar a chamada.
- "Pedir a conta" é só um aviso: cria a chamada do tipo "conta" e mostra ao cliente "Avisamos o garçom. Ele vem até a mesa para fechar." O cliente continua vendo a sua parte e o total na "Comanda da mesa", que já existe; não há tela de resumo nova, forma de pagamento nem fechamento pelo celular. O fechamento, o pagamento e a baixa são do garçom (seção 6); pagar pelo app é Fase 3.
- O garçom vê as chamadas no mapa (ícone de sino na mesa, contador no topo, som e vibração) e marca "Atendida". Chamada sem atendimento em 30 minutos expira sozinha, e fica registrada.
- Gestor vê no histórico o tempo médio de atendimento das chamadas.

## 13. Gestão de assinaturas

Para quem: revenda.

**Modelo**

- Nova tabela `plans (id, reseller_id, name, price_cents, billing_period mensal|anual, max_tables nulo = ilimitado, features jsonb, active)`. Chaves de `features`: `bar`, `stock`, `finance`, `reports`, `service_calls`, `custom_domain`.
- Nova tabela `subscriptions (id, restaurant_id único, plan_id, status teste|ativa|atrasada|suspensa|cancelada, trial_ends_at, current_period_end, grace_days padrão 5, notes)`.
- Nova tabela `subscription_payments (id, subscription_id, amount_cents, paid_at, period_start, period_end, method, note, registered_by)`.

**Regras**

- **(proposta)** Cobrança registrada à mão pela revenda: ela recebe fora do sistema (Pix, boleto, transferência) e registra o pagamento, que estende `current_period_end`. Integração com gateway (Asaas, Stripe) fica para a Fase 3.
- Período de teste configurável por plano (padrão 14 dias). Ao terminar sem pagamento, a assinatura vira `atrasada`; passados os dias de carência, vira `suspensa`.
- Restaurante `suspenso`: cardápio do cliente mostra "Cardápio temporariamente indisponível" e não aceita pedidos; painel abre só em modo leitura com aviso e o contato da revenda. Nada é apagado. Voltar a `ativa` libera tudo na hora.
- `atrasada`: tudo funciona, com faixa de aviso no painel do gestor.
- O plano manda nos módulos: função fora do plano some do painel e a API responde 403 com a mensagem "Função não incluída no seu plano". Troca de plano vale na hora.
- A tela Restaurantes da revenda ganha coluna de plano e status da assinatura, filtro por status e total de receita recorrente do mês (soma dos planos ativos). A migration cria um plano "Completo" por revenda e vincula os restaurantes existentes como `ativa` sem data de vencimento, para nada mudar nos testes dos sócios.

## 14. Comanda compartilhada em tempo real

Para quem: cliente.

- **(proposta)** Manter a consulta ao servidor, mas mais apertada: a cada 3 s enquanto a tela "Comanda da mesa" está aberta e visível, 10 s no cardápio, pausa quando a aba está em segundo plano e atualização imediata ao voltar e depois de qualquer ação própria (pedir, cancelar, chamar). Mostra "Atualizado agora" no rodapé da comanda.
- Alternativa, com custo maior: Supabase Realtime Broadcast com canal privado por comanda e token de curta duração emitido pelo servidor para o celular do cliente. Atualiza em menos de 1 s, mas exige autenticação do Realtime para anônimos e mais um ponto de falha em rede ruim. Só vale se os 3 s não bastarem na prática.
- Status do pedido e itens esgotados seguem o mesmo ritmo.

## 15. Pesquisa de satisfação do cliente

Para quem: cliente responde; gestor acompanha; revenda vê só a média por restaurante.

**Modelo**

- Nova tabela `surveys (id, restaurant_id, tab_id, guest_id, rating 1–5, food_rating, service_rating, wait_rating (1–5, opcionais), tags text[], comment até 300 caracteres, created_at)`. Índice único por `guest_id`: cada pessoa responde uma vez por comanda.
- Nova tabela `survey_invites (token_hash, tab_id, guest_id, expires_at, used_at)`. Hoje fechar a comanda apaga as sessões do celular; o gatilho passa a copiar o hash de cada sessão para esta tabela antes de apagar, com validade de 24 h. Assim o celular do cliente continua reconhecido só para responder a pesquisa, sem voltar a conseguir pedir.
- `restaurants` ganha `google_review_url` (link "Avalie no Google" do restaurante, opcional) e `survey_enabled` (padrão verdadeiro).

**Regras**

- Quando a comanda fecha, o cardápio do cliente, que já consulta o servidor, troca a tela "Mesa fechada" por "Como foi sua experiência no Brasa Bistrô?": 5 estrelas grandes, e depois da nota, três notas rápidas opcionais (comida, atendimento, tempo de espera), etiquetas de um toque (ex.: "Rápido", "Demorou", "Comida ótima", "Pedido veio errado") e comentário opcional. Um botão só: "Enviar". "Agora não" fecha e não pergunta de novo.
- **(proposta)** Nota 4 ou 5 com `google_review_url` cadastrado: depois de enviar, aparece "Que bom! Pode deixar sua avaliação no Google?" com o link. Nota 3 ou menos: aparece "Obrigado. Seu comentário vai direto para o restaurante." sem link para o Google. A resposta é gravada do mesmo jeito nos dois casos.
- A pesquisa só é oferecida a quem digitou o PIN naquela comanda; mesa livre e quem só consultou o cardápio não veem.
- O comentário aparece para o gestor com o nome que a pessoa digitou no PIN, a mesa e a data. O cliente é avisado disso em letras pequenas antes de enviar.
- Nada obriga: a comanda fecha e o PIN perde a validade como hoje, independentemente de responder.
- Grava em `audit_log` só o envio (sem o conteúdo) para o histórico da comanda mostrar "avaliou com 5 estrelas".

**Telas**

- Cliente, tela 34: pesquisa, substituindo "Mesa fechada" por até 24 h depois do fechamento para quem estava na comanda.
- Gestor, nova tela **Satisfação**: média geral e por critério no período, distribuição de 1 a 5, taxa de resposta (respostas ÷ pessoas nas comandas fechadas), etiquetas mais marcadas, lista de comentários com nome, mesa, nota e link para a comanda no histórico. Filtro de período igual ao dos relatórios e "Exportar CSV".
- Gestor, Configurações: ligar e desligar a pesquisa e o link do Google.
- Revenda, Restaurantes: coluna com a média dos últimos 30 dias.

## Novas telas

| # | Papel | Tela | Rota |
| --- | --- | --- | --- |
| 21 | Cliente | Chamar garçom e pedir a conta (folha sobre o cardápio; só avisa, não fecha) | `/[slug]/m/[qrToken]` |
| 22 | Garçom | Chamadas da mesa e registrar pagamento (no detalhe da mesa) | `/app/garcom` |
| 23 | Garçom | Unir e separar mesas (no detalhe da mesa) | `/app/garcom` |
| 24 | Garçom | Comandas fechadas hoje | `/app/garcom` |
| 25 | Bar | Fila do bar e esgotados do bar | `/app/bar` |
| 26 | Gestor | Estoque | `/app/gestor` |
| 27 | Gestor | Financeiro e fechamento do dia | `/app/gestor` |
| 28 | Gestor | Relatórios | `/app/gestor` |
| 29 | Gestor | Histórico de comandas e operações | `/app/gestor` |
| 30 | Gestor | Equipe com papéis e permissões (reforma da 17) | `/app/gestor` |
| 31 | Revenda | Planos e assinaturas | `/app/revenda` |
| 32 | Revenda | Domínio próprio e suporte (na tela Marca) | `/app/revenda` |
| 33 | Todos | Ajuda | folha em qualquer painel |
| 34 | Cliente | Pesquisa de satisfação (no lugar de "Mesa fechada") | `/[slug]/m/[qrToken]` |
| 35 | Gestor | Satisfação | `/app/gestor` |

## Ordem de construção

Cada etapa termina com typecheck, lint, `db:check` com verificações novas, testes unitários do que for regra pura e um E2E quando o fluxo for do cliente ou do garçom. Deploy de produção só ao fim de cada etapa, com os dados dos sócios preservados.

1. **Base:** `audit_log`, papéis múltiplos e permissões, papel `bar`, migração do `role` para `roles`, tela de equipe reformada. Toda RPC e rota existente passa a registrar no `audit_log`.
2. **Cancelamento por item e estoque:** colunas e trigger de total, telas do cliente e do garçom, estoque com baixa e reposição, tela Estoque.
3. **Alertas e chamadas:** sons, vibração, contador no título; `service_calls`, botão do cliente, atendimento pelo garçom.
4. **Bar:** setor em categoria e item, pedido dividido por setor com `batch_id`, `/app/bar`, status por setor para cliente e garçom.
5. **Unir mesas:** `tab_tables`, índice novo, QR de qualquer mesa, unir e separar, mapa e cards.
6. **Financeiro:** `payments`, taxa de serviço, desconto, fechamento da comanda com conferência, fechamento do dia, tela Financeiro.
7. **Histórico, relatórios e satisfação:** telas de histórico, relatórios por período, CSV, paginação por período no painel; `surveys`, `survey_invites`, pesquisa no celular do cliente, tela Satisfação e link do Google.
8. **Assinaturas, planos e suporte:** `plans`, `subscriptions`, gating por módulo, bloqueio por suspensão, contato de suporte e botão Ajuda.
9. **Domínio próprio:** integração com a API da Vercel, resolução por `Host` no `proxy.ts`, tela de DNS e status.
10. **Tempo real do cliente:** ritmo de 3 s com pausa em segundo plano e "Atualizado agora".
11. **Fechamento:** E2E completo em produção, atualização de `docs/progresso.md`, `README.md` e desta spec com o que foi decidido.

## Critérios de aceite

Todos verificados em 21/10/2026: E2E local (13 cenários), E2E em produção (12; o de domínio depende do `Host` e só roda local), `db:check` (247 verificações) e testes unitários. Evidências por etapa em `progresso.md`.

- [x] Pedido novo toca som na cozinha e no bar em até 3 s, uma vez por pedido, só depois de "Ativar som".
- [x] Cliente cancela um item de pedido `recebido`; o total da comanda, a parte de cada pessoa e o estoque mudam na hora; garçom não cancela item `entregue`.
- [x] Mesa 13 unida à comanda da mesa 12: o QR da 13 abre a comanda da 12 com o mesmo PIN; fechar a comanda libera as duas.
- [x] Item com estoque 2 recusa pedido de 3 com a mensagem certa; chega a zero e some do cardápio em até 10 s; reposição traz de volta.
- [x] Comanda com R$ 100 de itens e 10% de taxa só fecha com R$ 110 registrados (ou R$ 100 com a taxa retirada); o fechamento do dia bate com a soma das comandas.
- [x] Domínio da revenda ativo serve o cardápio; o QR impresso com a URL antiga continua abrindo a mesma mesa.
- [x] Relatório de 30 dias exporta CSV que abre no Excel com acentos corretos e totais iguais aos da tela.
- [x] Pedido com um prato e uma bebida aparece na cozinha só com o prato e no bar só com a bebida; o cliente vê um pedido com status por setor.
- [x] Garçom sem a permissão "aplicar desconto" recebe 403 ao tentar pela API.
- [x] Toda ação da lista da seção 11 aparece no histórico com quem fez e quando.
- [x] Cliente chama o garçom; o celular do garçom vibra e mostra a mesa em até 3 s; mesa livre só consegue chamar uma vez a cada 2 minutos. "Pedir a conta" só cria o aviso: nenhuma rota do cliente fecha comanda ou registra pagamento.
- [x] Comanda fechada: em até 10 s o celular de quem digitou o PIN mostra a pesquisa; a resposta grava uma vez por pessoa; o mesmo celular não consegue mais pedir; nota 5 com link do Google cadastrado mostra o botão, nota 2 não; o gestor vê a média e o comentário.
- [x] Restaurante suspenso não aceita pedidos e mostra o aviso; voltar a ativo libera na hora; função fora do plano responde 403.
- [x] Comanda da mesa atualiza em até 3 s para outro celular da mesma mesa quando alguém pede, cancela ou paga.
- [x] Gestor de um restaurante continua sem ver dado nenhum de outro, inclusive nas tabelas novas.

## Fora desta fase

Fechamento da conta pelo celular do cliente (ele só avisa o garçom), pagamento pelo app (Pix), integração com gateway de cobrança, notificações push fora do navegador, ficha técnica e insumos, despesas e fluxo de caixa, nota fiscal, PDV, impressão automática, importar cardápio por foto, resumo semanal no WhatsApp, fidelidade, outros idiomas, delivery. Confirmado pelo usuário em 20/10.

## Decisões confirmadas

Aprovadas pelo usuário em 20/10/2026 ("Aprovo as 9 decisões") e implementadas até 21/10/2026. Ajustes feitos durante a construção, além do que está acima:

- O cardápio do cliente consulta o servidor a cada 5 s, e não 10 s, para o critério "esgotado some em até 10 s" ter margem. A comanda segue os 3 s.
- O registro automático de domínio na Vercel depende de `VERCEL_TOKEN`, `VERCEL_PROJECT_ID_MENU` e `VERCEL_TEAM_ID` no ambiente do painel; sem eles a tela mostra as instruções de DNS e avisa que o registro está desligado. O painel da equipe continua só na URL do projeto `cardapio-digital`.
- Fechar comanda pelo garçom exige saldo zerado ("Faltam R$ X"); fechamento do dia fica no Financeiro do gestor.
- Expiração das chamadas (30 min) roda na leitura das telas do garçom, sem agendador.
- O restaurante novo nasce em teste (14 dias por padrão, configurável no plano) com o plano "Completo" da revenda; os restaurantes anteriores à fase ficaram `ativa` sem vencimento.

1. **Suporte** é contato direto com a revenda por WhatsApp e e-mail, sem fila de chamados no painel.
2. **Unir duas comandas abertas** move tudo para a primeira e invalida os celulares da segunda, que digitam o PIN de novo.
3. **Taxa de serviço** configurável por restaurante, padrão 0, opcional na hora de fechar. **Desconto** só com permissão e motivo, sem cupom.
4. **Bar** divide o envio em um pedido por setor, com o cliente vendo um pedido só com status por setor; bar usa a mesma regra de fila da cozinha.
5. **Assinaturas** com cobrança registrada à mão pela revenda e módulos ligados por plano; gateway fica para a Fase 3.
6. **Domínio por restaurante** entra como módulo opcional, além do domínio da revenda.
7. **Tempo real do cliente** por consulta a cada 3 s, em vez de Realtime com autenticação para anônimos.
8. **Histórico** visível por 12 meses no painel.
9. **Pesquisa de satisfação** aparece uma vez por pessoa ao fechar a comanda, com nota de 1 a 5 e comentário; só nota 4 ou 5 recebe o convite para avaliar no Google; o gestor vê o comentário com o nome digitado no PIN.
