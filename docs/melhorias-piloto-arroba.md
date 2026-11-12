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

## Verificação

Typecheck, lint, 30 testes unitários e build. Telas conferidas numa prévia local com os dados reais do cardápio do Arroba (comanda, conta pedida, mesa paga, Salão com plural e divisão). O som não foi ouvido aqui: conferir no próximo teste em produção.
