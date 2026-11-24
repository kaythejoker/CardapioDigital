// Cardápio do Pastel do Chef (piloto MesaClick), copiado do delivery da casa
// (https://www.webleva.com/pasteldochef) em 2026-11-21. Preços em centavos.
// Fotos em ./fotos, com o número do produto no site de origem. Itens sem foto
// lá também ficam sem foto aqui: o gestor pode subir depois pelo painel.
import type { PilotCategory, PilotItem, PilotModifierGroup } from "../arroba-menu";

export const PASTEL = {
  name: "Pastel do Chef",
  slug: "pastel-do-chef",
  envPrefix: "PASTEL",
  // Vermelho do letreiro da logo e fundo creme quente (massa de pastel).
  primary_color: "#D7261E",
  background_color: "#FFF6E5",
  tables: ["1", "2"],
  logo: "logo.webp",
  cover: "capa.webp",
};

/** Pastel 12cm é o preço base; o pastelão cobra a diferença. */
const tamanho = (pastel: number, pastelao: number): PilotModifierGroup => ({
  name: "Tamanho",
  required: true,
  min: 1,
  max: 1,
  options: [
    ["Pastel 12cm", 0],
    ["Pastelão 20cm", pastelao - pastel],
  ],
});
const molhoVerde: PilotModifierGroup = {
  name: "Adicionais",
  required: false,
  min: 0,
  max: 1,
  options: [["Molho verde", 100]],
};
const BEBIDAS_PARES = ["Coca-Cola 350ml", "Guaraná 350ml", "Suco Açaí 300ml"];

type Extra = Partial<PilotItem> & { semMolho?: boolean };
/** Pastel salgado: 12cm ou pastelão 20cm, com molho verde opcional. */
const salgado = (name: string, pastel: number, pastelao: number, extra: Extra = {}): PilotItem => {
  const { semMolho, ...rest } = extra;
  return {
    name,
    price: pastel,
    prep: 12,
    groups: semMolho ? [tamanho(pastel, pastelao)] : [tamanho(pastel, pastelao), molhoVerde],
    pairs: BEBIDAS_PARES,
    ...rest,
  };
};
const simples = (name: string, extra: Extra = {}) => salgado(name, 650, 1450, extra);
const especial = (name: string, extra: Extra = {}) => salgado(name, 750, 1550, extra);
const doce = (name: string, pastel: number, pastelao: number, photo?: string): PilotItem => ({
  name,
  price: pastel,
  prep: 12,
  photo,
  groups: [tamanho(pastel, pastelao)],
});

const acaiAdicionais: PilotModifierGroup = {
  name: "Adicionais",
  required: false,
  min: 0,
  max: 11,
  options: [
    ["Chocoball", 500],
    ["Cobertura de chocolate", 400],
    ["Cobertura de morango", 400],
    ["Confete", 500],
    ["Granola", 500],
    ["Leite condensado", 500],
    ["Leite em pó", 500],
    ["Morango", 600],
    ["Nutella", 800],
    ["Ovomaltine", 500],
    ["Paçoca", 500],
  ],
};
const acai = (name: string, price: number, adicionais: boolean): PilotItem => ({
  name,
  price,
  prep: 5,
  ...(adicionais ? { groups: [acaiAdicionais] } : {}),
});
const unidade = (name: string, price: number, extra: Partial<PilotItem> = {}): PilotItem => ({
  name,
  price,
  prep: 2,
  ...extra,
});

// Sabores dos combos, como no site: alguns custam R$ 1,00 a mais nos combos de 2.
const SABORES: [name: string, extraNoCombo2: number][] = [
  ["Banana com canela", 100],
  ["Banana com chocolate", 100],
  ["Banana com doce de leite", 100],
  ["Banana com mussarela", 100],
  ["Carne", 0],
  ["Carne com bacon", 100],
  ["Carne com bacon e catupiry", 100],
  ["Carne com bacon e cheddar", 100],
  ["Carne com catupiry", 100],
  ["Carne com cheddar", 100],
  ["Carne com ovo", 100],
  ["Carne com palmito", 100],
  ["Carne com queijo", 100],
  ["Chocolate", 100],
  ["Churros", 100],
  ["Do Chef", 0],
  ["Doce de leite e queijo", 100],
  ["Frango com alho poró", 100],
  ["Frango com alho poró e catupiry", 100],
  ["Frango com bacon", 100],
  ["Frango com bacon e catupiry", 100],
  ["Frango com bacon e cheddar", 100],
  ["Frango com catupiry", 0],
  ["Frango com cheddar", 0],
  ["Frango com milho e catupiry", 0],
  ["Frango com palmito e catupiry", 0],
  ["Lasanha", 100],
  ["Milho com bacon e catupiry", 0],
  ["Milho com catupiry", 100],
  ["Milho com queijo e azeitona", 100],
  ["Milho com queijo e palmito", 100],
  ["Palmito com catupiry", 0],
  ["Pizza", 0],
  ["Queijo", 0],
  ["Queijo com alho poró", 100],
  ["Romeu e julieta", 100],
];
const sabor = (n: number, comExtra: boolean): PilotModifierGroup => ({
  name: `${n}º pastel`,
  required: true,
  min: 1,
  max: 1,
  options: SABORES.map(([s, extra]) => [s, comExtra ? extra : 0]),
});
const um = (name: string, options: string[]): PilotModifierGroup => ({
  name,
  required: true,
  min: 1,
  max: 1,
  options: options.map((o) => [o, 0]),
});

export const PASTEL_MENU: PilotCategory[] = [
  {
    name: "Promoções",
    items: [
      {
        name: "2 Pastéis + 1 Refri 200ml",
        price: 1500,
        prep: 12,
        description: "Dois pastéis 12cm à sua escolha e um refrigerante 200ml.",
        groups: [um("Refri 200ml", ["Coca-Cola", "Guaraná"]), sabor(1, true), sabor(2, true), molhoVerde],
      },
      {
        name: "2 Pastéis + 1 Suco de açaí 300ml",
        price: 2150,
        prep: 12,
        description: "Dois pastéis 12cm à sua escolha e um suco de açaí 300ml.",
        groups: [sabor(1, true), sabor(2, true), molhoVerde],
      },
      {
        name: "10 Pastéis + Guaraná 2L",
        price: 7500,
        prep: 20,
        description: "Dez pastéis 12cm à sua escolha e um Guaraná 2L.",
        groups: [...Array.from({ length: 10 }, (_, i) => sabor(i + 1, false)), molhoVerde],
      },
    ],
  },
  {
    name: "Pastel Simples",
    items: [
      simples("Pastel de Carne"),
      simples("Pastel de Queijo", { photo: "9.jpg" }),
      simples("Pastel de Frango"),
      simples("Pastel de Pizza", { photo: "10.jpg" }),
    ],
  },
  {
    name: "Pastel Especiais",
    items: [
      especial("Pastel do Chef", {
        description: "Bacon, cebola, milho, mussarela, orégano, presunto e tomate.",
      }),
      especial("Pastel Carne com Bacon", { photo: "34.jpg", featured: true }),
      especial("Pastel Carne com Cheddar", { photo: "38.jpg", featured: true }),
      especial("Pastel Carne com Catupiry"),
      especial("Pastel Carne com Queijo"),
      especial("Pastel Carne com Ovo", { photo: "41.jpg" }),
      especial("Pastel Carne com Palmito"),
      especial("Pastel Carne com Alho Poró", { photo: "101.jpg" }),
      especial("Pastel Carne com Azeitona", { semMolho: true }),
      especial("Pastel Carne com Jiló", { photo: "107.jpg", semMolho: true }),
      especial("Pastel Carne Bacon com Catupiry"),
      especial("Pastel Carne Bacon com Cheddar"),
      especial("Pastel Carne Seca com Alho Poró e Cream Cheese"),
      especial("Pastel Calabresa com Alho Poró e Cream Cheese", { photo: "104.jpg" }),
      especial("Pastel de Frango com Catupiry"),
      especial("Pastel de Frango com Cheddar", { photo: "12.jpg" }),
      especial("Pastel de Frango com Milho e Catupiry", { photo: "13.jpg", featured: true }),
      especial("Pastel de Frango com Palmito e Catupiry"),
      especial("Pastel Frango com Alho Poró"),
      especial("Pastel Frango com Alho Poró e Catupiry"),
      especial("Pastel Frango com Bacon"),
      especial("Pastel Frango com Bacon e Catupiry"),
      especial("Pastel Frango com Bacon e Cheddar"),
      especial("Pastel de Lasanha", { photo: "50.jpg" }),
      especial("Pastel de Milho com Bacon e Catupiry", { photo: "15.jpg" }),
      especial("Pastel Milho com Catupiry"),
      especial("Pastel Milho com Queijo e Azeitona", { photo: "48.jpg" }),
      especial("Pastel Milho com Queijo e Palmito", { photo: "49.jpg" }),
      especial("Pastel de Palmito com Catupiry", { photo: "78.jpg" }),
      especial("Pastel Palmito com Alho Poró", { semMolho: true }),
      especial("Pastel Queijo com Alho Poró", { photo: "51.jpg" }),
      especial("Pastel Queijo com Bacon e Alho Poró"),
    ],
  },
  {
    name: "Pastel Burguer",
    items: [
      {
        name: "Pastel Burguer - Opção 1",
        description: "Hambúrguer de picanha, bacon, milho, mussarela, presunto e tomate.",
        price: 1999,
        prep: 15,
        photo: "79.jpg",
        featured: true,
        groups: [um("Escolha seu queijo", ["Catupiry", "Cheddar", "Nenhum queijo"]), molhoVerde],
        pairs: BEBIDAS_PARES,
      },
      {
        name: "Pastel Burguer - Opção 2",
        description: "Hambúrguer de picanha, frango desfiado e bacon.",
        price: 1999,
        prep: 15,
        photo: "82.jpg",
        groups: [um("Escolha seu queijo", ["Catupiry", "Cheddar", "Nenhum queijo"]), molhoVerde],
        pairs: BEBIDAS_PARES,
      },
    ],
  },
  {
    name: "Pastel Doce",
    suggestAtBill: true,
    items: [
      doce("Pastel de Chocolate", 699, 1500, "21.jpg"),
      doce("Pastel de Churros", 699, 1500, "22.jpg"),
      doce("Pastel de Banana com Canela", 699, 1500),
      doce("Pastel de Banana com Chocolate", 699, 1500, "18.jpg"),
      doce("Pastel de Banana com Doce de Leite", 699, 1500),
      doce("Pastel de Banana com Mussarela", 699, 1500, "20.jpg"),
      doce("Pastel de Doce de Leite com Queijo", 699, 1500, "23.jpg"),
      doce("Pastel de Romeu e Julieta", 699, 1500, "25.jpg"),
    ],
  },
  {
    name: "Pastel Doces Especiais",
    suggestAtBill: true,
    items: [
      doce("Pastel de Nutella", 899, 1700, "24.jpg"),
      { ...doce("Pastel de Nutella com Morango", 899, 1700, "97.jpg"), featured: true },
    ],
  },
  {
    name: "Açaí - Creme",
    items: [
      acai("Creme Açaí 300ml", 1700, true),
      acai("Creme Açaí 500ml", 2000, true),
      acai("Creme Açaí 700ml", 2500, true),
      acai("Creme Açaí 1 Litro", 3500, true),
    ],
  },
  {
    name: "Açaí - Suco",
    items: [
      // No site, só o de 1 litro aceita adicionais.
      acai("Suco Açaí 300ml", 1200, false),
      acai("Suco Açaí 500ml", 1500, false),
      acai("Suco Açaí 700ml", 1800, false),
      acai("Suco Açaí 1 Litro", 2800, true),
    ],
  },
  {
    name: "Adicionais",
    items: [
      unidade("Molho verde", 100),
      unidade("Chocoball", 500),
      unidade("Cobertura de Chocolate", 400),
      unidade("Cobertura de Morango", 400),
      unidade("Confete", 500),
      unidade("Granola", 500),
      unidade("Leite Condensado", 500),
      unidade("Leite em Pó", 500),
      unidade("Morango", 600),
      unidade("Nutella", 800),
      unidade("Ovomaltine", 500),
      unidade("Paçoca", 500),
    ],
  },
  {
    name: "Bebidas",
    items: [
      unidade("Coca-Cola 200ml", 350),
      unidade("Coca-Cola 200ml Zero", 350),
      unidade("Coca-Cola 350ml", 650),
      unidade("Coca-Cola 350ml Zero", 650),
      unidade("Coca-Cola 2L", 1500),
      unidade("Coca-Cola 2L Zero", 1500),
      unidade("Guaraná 200ml", 350),
      unidade("Guaraná 350ml", 650),
      unidade("Guaraná 350ml Zero", 650),
      unidade("Guaraná 1L Zero", 900),
      unidade("Guaraná 2L", 1300),
      unidade("Limoneto lata 350ml", 700),
      unidade("Suco Del Valle 290ml Manga", 700),
      unidade("Suco Del Valle 290ml Maracujá", 700),
      unidade("Suco Del Valle 290ml Uva", 700),
      unidade("Água Mineral", 400),
      unidade("Água com Gás", 550),
      unidade("Heineken latão 473ml", 1200),
    ],
  },
];
