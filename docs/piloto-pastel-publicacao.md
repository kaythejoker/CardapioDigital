# Piloto MesaClick no Pastel do Chef (21/11/2026)

O piloto mudou: o primeiro restaurante deixa de ser o Arroba Experience e passa a ser a pastelaria **Pastel do Chef** (delivery em https://www.webleva.com/pasteldochef, contato (31) 98224-1419). O Arroba foi **desativado** em 21/11 (mesmo efeito do botão "Desativar" da revenda: cardápio e QR codes deixam de abrir) e perdeu o domínio `arroba.nutrivox.com.br`. Cardápio, mesas e pedidos dele continuam no banco; para voltar, "Ativar" em Revenda → Restaurantes.

## O que foi feito

- **Cardápio copiado do delivery** (`scripts/pilot/pasteldochef/menu.ts`): 10 categorias, 89 itens, com os nomes e preços do site.
  - Pastéis: preço do pastel 12cm, com "Tamanho" obrigatório (Pastel 12cm ou Pastelão 20cm, que cobra a diferença: +R$ 8,00 nos salgados, +R$ 8,01 nos doces e no de Nutella) e "Molho verde" (+R$ 1,00) onde o site oferece.
  - Pastel Burguer: "Escolha seu queijo" (Catupiry, Cheddar ou Nenhum queijo). Os ingredientes estão na descrição; para tirar algum, o cliente usa a observação.
  - Açaí no creme (e o suco de 1 litro, como no site): 11 adicionais opcionais.
  - Combos: "2 Pastéis + 1 Refri 200ml" (refri + 1º e 2º sabor, alguns +R$ 1,00), "2 Pastéis + 1 Suco de açaí 300ml" e "10 Pastéis + Guaraná 2L" (10 escolhas de sabor).
  - Pequenas correções de grafia: "Do chefe" → "Do Chef", "Poro" → "Poró", "Pasteis" → "Pastéis", "guarana 1 litro ZERO" → "Guaraná 1L Zero", "Heineken" → "Heineken latão 473ml".
- **Fotos**: as 26 que existem no site (`scripts/pilot/pasteldochef/fotos`, número do produto de origem). O "Pastel Carne com Azeitona" tem foto quebrada no site e ficou sem.
- **Identidade visual**: logo recortada do banner do site (`logo.webp`), banner com a foto do Pastel Burguer (`capa.webp`), cor principal vermelho `#D7261E` (letreiro da logo) e fundo creme `#FFF6E5`.
- **Destaques da casa**: Pastel Burguer - Opção 1, Carne com Bacon, Carne com Cheddar, Frango com Milho e Catupiry e Nutella com Morango.
- **Vendas casadas** já ligadas: pastéis salgados e burguer "combinam com" Coca-Cola 350ml, Guaraná 350ml e Suco Açaí 300ml; as duas categorias de pastel doce aparecem como sugestão quando o cliente pede a conta.
- **Restaurante criado em produção** (`npm run pilot:pastel`, já rodado): `pastel-do-chef`, mesas 1 e 2, na revenda do Felipe, assinatura ativa sem vencimento. Tudo cai na fila da cozinha.
- O script do Arroba virou genérico: `scripts/setup-pilot.ts` (`npm run pilot:arroba` e `npm run pilot:pastel`). `npm run db:check` confere o cardápio inteiro da pastelaria no banco e um pedido de pastelão + combo (R$ 32,50).

Nenhuma tela mudou, então não precisa publicar na Vercel.

## Links

- Cardápio para consulta: https://cardapio-cliente-three.vercel.app/pastel-do-chef/consulta
- Mesa 1: https://cardapio-cliente-three.vercel.app/pastel-do-chef/m/e50a8ae0dc5d4e109eb710d58b153503
- Mesa 2: https://cardapio-cliente-three.vercel.app/pastel-do-chef/m/23b4992887134226b407b2b8199f24ae
- Painéis: login da revenda, escolhendo "Pastel do Chef" no seletor de restaurante. O PDF dos QR codes sai em Gestor → Mesas e QR.

## Pendências

- Opcional: remover `arroba.nutrivox.com.br` do projeto `cardapio-cliente` na Vercel e o CNAME `arroba` na HostGator (os dois ainda existem).

## Domínio da pastelaria (24/11/2026)

**https://pasteldochef.nutrivox.com.br** (o pedido veio como "nutrivoxx", mas esse domínio não existe; o da conta é `nutrivox.com.br`).

- HostGator, cPanel do Plano M (servidor br996), zona `nutrivox.com.br`: CNAME `pasteldochef` → `cname.vercel-dns.com.` (TTL 14400), igual ao `arroba`. O portal novo da HostGator não edita DNS: o caminho é Sites → Plano M → cPanel → Editor de zona.
- Vercel: `vercel domains add pasteldochef.nutrivox.com.br cardapio-cliente --scope nutrivox`.
- Banco: `custom_domain = 'pasteldochef.nutrivox.com.br'` e `custom_domain_status = 'active'` (marcado à mão depois que o HTTPS abriu, porque não há `VERCEL_TOKEN`). Com o status ativo, os QR codes usam o domínio: **baixe de novo o PDF** em Gestor → Mesas e QR. Os links antigos do `cardapio-cliente-three.vercel.app` continuam funcionando.
- Painéis da equipe: continuam em `gestor.arroba.nutrivox.com.br` (abre o login, não depende do restaurante) ou no endereço da Vercel.

Resolvido em 21/11: o gestor da pastelaria é o mesmo login do Arroba (`PASTEL_MANAGER_*` no `.env.local`, cópia dos `ARROBA_MANAGER_*`) e ficam 2 mesas.
- Se as bebidas vão para um bar separado (trocar o setor da categoria no gestor).
- Fotos que faltam (63 itens sem foto, como no site), pelo painel do gestor.

## Cartões de mesa (24/11/2026)

Mesmo modelo do cartão do Arroba (fundo azul-marinho, borda dourada, faixa "MESA N", QR, MesaClick e Nutrivox Digital), com a logo do Pastel do Chef no círculo. Gerados por `npm run pilot:cartoes -- pastel-do-chef` em `output/cartoes/pastel-do-chef/mesa-1.png` e `mesa-2.png` (2172 x 2896 px, 3:4, fora do Git). O script lê do banco a logo, o domínio ativo e as mesas; o QR aponta para `https://pasteldochef.nutrivox.com.br/m/{qr}`, igual ao PDF do painel. Os dois QR foram lidos e abrem a mesa certa.
