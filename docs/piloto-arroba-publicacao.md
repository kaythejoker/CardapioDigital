# Piloto MesaClick no Arroba Experience — o que falta publicar

Feito em 2026-11-12 num PC sem credenciais (sem `.env.local`, sem acesso ao time `nutrivox` na Vercel). **Nada disto está em produção ainda.** Rode os passos abaixo no PC que tem as credenciais.

## Contexto

Os sócios mandaram a lista "Teste 02 mesas - MesaClick" para implantar o primeiro restaurante real: **Arroba Experience** (Instagram @arrobaexperience), 2 mesas. Quase tudo da lista já existia (fases 2 e 3: unir mesas, pedir a conta pelo celular, pagamento por forma, alertas sonoros, suporte, marca MesaClick). Esta entrega acrescenta só:

1. **Mapa das mesas com as cores dos sócios** (`lib/table-state.ts`): 🟢 livre, 🔴 ocupada, 🟠 em fechamento (alguém pediu a conta), 🔵 10 minutos sem pedido. Legenda acima do mapa e filtro "Fechamento". "Atrasada" e "Chamando" continuam como selo e anel por cima da cor. Isso substitui o fundo azul-claro de "ocupada" e o fundo vermelho/âmbar de atraso e chamada de 07/11. Não precisa de migration.
2. **Cadastro do Arroba** (`npm run pilot:arroba`): restaurante `arroba-experience` na mesma revenda do `brasa-demo`, logo (`scripts/pilot/arroba-logo.webp`), cores dourado `#B7791F` e creme `#FBF6EC`, cardápio transcrito das fotos do cardápio de mesa (`scripts/pilot/arroba-menu.ts`: 16 categorias, 125 itens, 5 destaques, "Turbine sua porção" como adicional dos grelhados) e mesas 1 e 2. A assinatura fica **ativa, sem vencimento** (nota "Piloto MesaClick"), para o teste de 14 dias não suspender o piloto. Tudo cai na fila da **cozinha**: o Arroba ainda não disse se terá bar separado.

Validação feita aqui: typecheck, lint, build, 30 testes unitários e `npm run db:check` com 312 verificações (inclui o cardápio inteiro do Arroba no banco, um pedido de Picanha premium + Turbine somando R$ 152,80 e o acesso do piloto liberado). O mapa do salão foi conferido no navegador com dados simulados. A E2E contra produção não foi rodada.

## Passo a passo no PC com credenciais

1. Atualizar e instalar (não rodar seed nem reset; os sócios usam a demonstração):

   ```bash
   git pull
   ```
   ```bash
   npm ci
   ```

2. Conferir localmente:

   ```bash
   npm test
   ```
   ```bash
   npm run db:check
   ```
   ```bash
   npm run pilot:arroba -- --dry-run
   ```

3. Opcional, no `.env.local` (pode ficar para depois):

   ```
   SUPPORT_WHATSAPP=5531999998888   # suporte da revenda; também editável em Revenda → Marca
   ARROBA_MANAGER_EMAIL=...         # cria o gestor do Arroba já com acesso
   ARROBA_MANAGER_PASSWORD=...      # senha inicial, 12+ caracteres
   ARROBA_MANAGER_NAME=...
   ```

4. Criar o restaurante em produção (pode rodar de novo sem risco: se `arroba-experience` já existir, não mexe em cardápio, mesas, PINs nem pedidos):

   ```bash
   npm run pilot:arroba
   ```

   O script imprime as URLs dos QR codes das mesas 1 e 2.

5. Publicar os dois projetos Vercel pela pasta local, como nos deploys anteriores (`cardapio-digital` e `cardapio-cliente`).

6. Teste rápido em produção:
   - Gestor do Arroba → Mesas e QR: baixar o PDF dos QR codes.
   - Salão: abrir a mesa 1 (fica vermelha), unir a mesa 2.
   - Celular no QR da mesa 2: nome + PIN, pedir Picanha premium com "Turbine sua porção" → cozinha recebe "Mesa 1+2" com som.
   - Celular: "Pedir a conta" → a mesa fica laranja.
   - Salão: registrar pagamento e fechar → mesas verdes, PIN não vale mais.
   - Mesa aberta 10 minutos sem pedido → azul.

## Pendências com os sócios

- Número do WhatsApp do suporte e e-mail do gestor do Arroba.
- Fotos dos pratos e banner (pelo painel do gestor).
- Conferir nomes e preços em `scripts/pilot/arroba-menu.ts`.
- Se terão bar separado: trocar o setor das categorias de bebida para "Bar" no gestor.
- Plano do Arroba depois do piloto (Revenda → Assinaturas).
