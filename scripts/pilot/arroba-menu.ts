// Cardápio do Arroba Experience (piloto MesaClick), transcrito das fotos do
// cardápio de mesa enviadas pelos sócios em 2026-11-12. Preços em centavos.
// Itens sem foto: o gestor pode subir as fotos depois pelo painel.

export type PilotModifierGroup = {
  name: string;
  required: boolean;
  min: number;
  max: number;
  options: [name: string, price_cents: number][];
};
export type PilotItem = {
  name: string;
  description?: string;
  price: number;
  prep: number;
  featured?: boolean;
  groups?: PilotModifierGroup[];
};
export type PilotCategory = { name: string; items: PilotItem[] };

export const ARROBA = {
  name: "Arroba Experience",
  slug: "arroba-experience",
  // Dourado do logo (fogo/letreiro) e fundo creme do cardápio de papel.
  primary_color: "#B7791F",
  background_color: "#FBF6EC",
  tables: ["1", "2"],
};

const turbine: PilotModifierGroup = {
  name: "Turbine sua porção",
  required: false,
  min: 0,
  max: 1,
  options: [
    ["Batata frita", 3290],
    ["Mandioca frita", 3290],
    ["Mandioca cozida", 3290],
    ["Batatonese da casa", 3290],
    ["Legumes salteados", 3290],
  ],
};
const grelhado = (
  name: string,
  price: number,
  extra: Partial<PilotItem> = {},
): PilotItem => ({ name, price, prep: 30, groups: [turbine], ...extra });
const one = (name: string, options: string[]): PilotModifierGroup => ({
  name,
  required: true,
  min: 1,
  max: 1,
  options: options.map((o) => [o, 0]),
});
const drink = (
  name: string,
  price: number,
  extra: Partial<PilotItem> = {},
): PilotItem => ({ name, price, prep: 2, ...extra });

const ACOMPANHAMENTOS_REFIL =
  "Acompanhamentos (arroz, farofa e vinagrete) servidos como refil. Solicite ao garçom.";

export const ARROBA_MENU: PilotCategory[] = [
  {
    name: "Grelhados na brasa (500g)",
    items: [
      grelhado("Picanha premium", 11990, { featured: true, description: "500g grelhados na brasa de verdade." }),
      grelhado("Filé mignon 4/5", 10990, { description: "500g grelhados na brasa." }),
      grelhado("Ancho (entrecôte)", 8990, { description: "500g grelhados na brasa." }),
      grelhado("Chorizo black angus (contra filé)", 8990, { description: "500g grelhados na brasa." }),
      grelhado("Maminha ao alho na manteiga de garrafa", 8590, { description: "500g grelhados na brasa." }),
      grelhado("Babybeef", 8590, { description: "Miolo de alcatra, 500g grelhados na brasa." }),
      grelhado("Costelão bovino desfiado com queijo", 9990, { description: "500g." }),
      grelhado("Cupim serenado com manteiga de garrafa", 9990, { description: "500g." }),
      grelhado("Maminha angus reserva black serenada", 9990, { description: "Com manteiga de garrafa, 500g." }),
      grelhado("Picanha premium serenada", 12990, { description: "Com manteiga de garrafa, 500g." }),
      grelhado("Picanha suína com especiarias", 5490, { description: "500g." }),
      grelhado("Torresmo de rolo", 5990, { description: "500g." }),
      grelhado("Torresmo em cubos", 3990, { description: "500g." }),
      grelhado("Costela suína defumada com barbecue", 9990, { description: "500g." }),
      grelhado("Linguiça artesanal recheada", 3990, { description: "500g. Pergunte os sabores ao garçom." }),
      grelhado("Linguiça toscana churrasco", 3290, { description: "500g." }),
      grelhado("Sobrecoxa desossada", 4590, { description: "500g." }),
      grelhado("Filé de peito grelhado", 5490, { description: "500g." }),
      grelhado("Filé de peito empanado", 5990, { description: "500g." }),
      grelhado("Drumet (coxinha da asa) grelhada", 4990, { description: "500g." }),
      grelhado("Drumet (coxinha da asa) empanada", 5490, { description: "500g." }),
      grelhado("Tulipinha (meio da asa) com catupiry", 6990, { description: "500g." }),
      grelhado("Tiras de tilápia empanada", 7990, { description: "500g." }),
      grelhado("Camafeu com catupiry", 8990, { description: "8 unidades." }),
      grelhado("Camarão na manteiga com alho", 9990, { description: "500g." }),
    ],
  },
  {
    name: "Campeão Festival Sabores Lagoa Santa",
    items: [
      {
        name: "Ancho que você gostar",
        price: 17990,
        prep: 35,
        featured: true,
        description:
          "500g de ancho bovino regado ao chimichurri com azeite de abacaxi, batatonese da casa com queijo provolone e aipo, abacaxi grelhado emulsionado com azeite de abacaxi e mel.",
      },
    ],
  },
  {
    name: "Porções e suculentos",
    items: [
      { name: "Filé mignon ao molho de queijo azul", price: 16990, prep: 30, description: "Filé mignon bovino (500g) ao molho de queijo azul e batata cross trax (300g)." },
      { name: "Costelão bovino com batata ao molho branco", price: 14990, prep: 30, description: "Costelão bovino (500g) + batata frita palito (500g) ao molho branco da casa." },
      { name: "Picanha ao molho quatro queijos", price: 16990, prep: 30, description: "Picanha bovina (500g) coberta ao molho quatro queijos e batata cross trax (300g)." },
      { name: "Maminha com alho e mandioca", price: 13990, prep: 30, description: "Maminha bovina (500g) com alho e mandioca cozida na manteiga de garrafa." },
      { name: "Parmegiana de babybeef", price: 13990, prep: 30, description: "Parmegiana de babybeef bovino (500g) ao molho sugo e batata frita palito (500g)." },
      { name: "Filé de frango com catupiry", price: 10990, prep: 25, description: "Filé de peito de frango (500g) com catupiry e batata cross trax (300g)." },
      { name: "Batata cross trax com pulled pork", price: 7990, prep: 20, description: "Batata cross trax (500g) com pulled pork (300g) e molho cheddar." },
      { name: "Batata frita", price: 3990, prep: 15, description: "500g." },
      { name: "Batata frita com queijo e bacon", price: 4690, prep: 15, description: "500g." },
      { name: "Mandioca cozida na manteiga de garrafa", price: 4290, prep: 15, description: "500g." },
      { name: "Mandioca frita", price: 3990, prep: 15, description: "500g." },
      { name: "Bolinho de costela recheado com muçarela", price: 5990, prep: 15, description: "6 unidades." },
    ],
  },
  {
    name: "Espetos tradicionais",
    items: [
      { name: "Espeto de boi (alcatra)", price: 1500, prep: 15 },
      { name: "Espeto suíno (pernil)", price: 1500, prep: 15 },
      { name: "Espeto de frango (filé de peito)", price: 1500, prep: 15 },
      { name: "Espeto de coração de frango", price: 1500, prep: 15 },
      { name: "Espeto de muçarela trancinha", price: 1500, prep: 15 },
      { name: "Espeto de kafta bovina", price: 1500, prep: 15 },
      { name: "Espeto de salsichão", price: 1500, prep: 15, description: "2 unidades.", groups: [{ name: "Mostarda", required: false, min: 0, max: 1, options: [["Com mostarda", 0]] }] },
    ],
  },
  {
    name: "Medalhões",
    items: [
      { name: "Medalhão de frango com muçarela", price: 1600, prep: 15 },
      { name: "Medalhão de boi (aranha de alcatra)", price: 1600, prep: 15 },
      { name: "Medalhão de muçarela", price: 1600, prep: 15 },
      { name: "Medalhão de batatinha com cheddar", price: 1600, prep: 15 },
      { name: "Cebola recheada", price: 1600, prep: 15 },
    ],
  },
  {
    name: "Espetos especiais",
    items: [
      { name: "Espeto de boi especial", price: 1700, prep: 15, groups: [one("Corte", ["Contra filé", "Fraldinha"])] },
      { name: "Espeto de almôndegas recheadas com queijo", price: 1700, prep: 15 },
      { name: "Queijo coalho com mel", price: 1700, prep: 12, description: "2 espetos." },
      { name: "Pão de alho", price: 1700, prep: 12, description: "2 unidades. Pergunte os sabores ao garçom." },
      { name: "Romeu e Julieta", price: 1700, prep: 12, description: "Muçarela com goiabada." },
    ],
  },
  {
    name: "Combos de espetos",
    items: [
      { name: "Combo 1 (10 espetos)", price: 12500, prep: 20, featured: true, description: "4 boi (alcatra) + 1 filé de peito + 1 coração de frango + 1 medalhão de muçarela + 1 almôndega recheada com queijo + 2 pães de alho." },
      { name: "Combo 2 (8 espetos)", price: 9700, prep: 20, description: "2 boi (alcatra) + 1 medalhão frango com muçarela + 1 pernil + 1 medalhão batatinha com cheddar + 1 coração de frango + 2 pães de alho." },
      { name: "Combo 3 (6 espetos)", price: 8400, prep: 20, description: "1 boi (alcatra) + 1 pernil + 1 filé de peito + 1 coração de frango + 1 medalhão muçarela + 1 almôndega recheada com queijo." },
    ],
  },
  {
    name: "Chapas família (com acompanhamentos)",
    items: [
      { name: "Picanha família", price: 29990, prep: 35, featured: true, description: `1kg de picanha bovina + 1kg de batata frita palito. ${ACOMPANHAMENTOS_REFIL}` },
      { name: "Babybeef família", price: 26990, prep: 35, description: `1kg de babybeef (miolo de alcatra) bovino + 1kg de batata frita palito. ${ACOMPANHAMENTOS_REFIL}` },
      { name: "Maminha família", price: 24990, prep: 35, description: `1kg de maminha bovina + 500g de mandioca cozida na manteiga de garrafa. ${ACOMPANHAMENTOS_REFIL}` },
      { name: "Filé mignon família", price: 29990, prep: 35, description: `1kg de filé mignon bovino + 500g de mandioca cozida na manteiga de garrafa. ${ACOMPANHAMENTOS_REFIL}` },
    ],
  },
  {
    name: "Chapas sem acompanhamentos",
    items: [
      { name: "Happy hour", price: 18990, prep: 30, description: "500g de chorizo (contra filé) bovino + 500g linguiça toscana churrasco + 500g torresmo de barriga + 500g batata frita palito." },
      { name: "Galerinha", price: 23990, prep: 30, description: "500g de filé mignon bovino + 500g de sobrecoxa desossada + 500g picanha suína + 500g mandioca cozida na manteiga de garrafa." },
      { name: "Junta junta", price: 14990, prep: 30, description: "500g babybeef (miolo de alcatra) bovino + 500g linguiça artesanal recheada + 500g mandioca frita." },
    ],
  },
  {
    name: "Sanduíches diferentões",
    items: [
      { name: "Ribs beef", price: 9990, prep: 25, featured: true, description: "Serve até 2 pessoas. Baguete italiana com costelão bovino desfiado (450g), lascas de bacon crocante, queijo muçarela, alface americana e tomate confitado. Acompanha 500g de batata frita palito." },
    ],
  },
  {
    name: "Saladas",
    items: [
      { name: "Salada tropical", price: 3990, prep: 10, description: "Para 2 pessoas. Alface americana, tomate, cenoura ralada, palmito, milho, grão de bico, azeitonas, manga e abacaxi." },
    ],
  },
  {
    name: "Adicionais",
    items: [
      { name: "Porção de arroz branco ao alho", price: 1990, prep: 10 },
      { name: "Porção de feijão carioca", price: 1990, prep: 10 },
      { name: "Porção de feijoada magra", price: 2590, prep: 10 },
      { name: "Porção de vinagrete de legumes", price: 1990, prep: 5 },
      { name: "Porção de farofa artesanal", price: 1990, prep: 5 },
      { name: "Acréscimo de queijo ou bacon", price: 1490, prep: 5, groups: [one("Escolha", ["Queijo", "Bacon"])] },
      { name: "Proteína à parte", price: 2590, prep: 15, groups: [one("Proteína", ["Bife de boi", "Peito de frango", "Lombo suíno", "Filé de tilápia", "Omelete recheado"])] },
      { name: "Ovo", price: 490, prep: 5, groups: [one("Preparo", ["Frito", "Cozido"])] },
      { name: "Molho à parte", price: 990, prep: 5, description: "Consulte disponibilidade." },
      { name: "Embalagem para viagem", price: 390, prep: 1 },
    ],
  },
  {
    name: "Cervejas",
    items: [
      drink("Baden Baden 600ml", 2300, { description: "Consulte os estilos." }),
      drink("Heineken 600ml", 2000),
      drink("Corona ou Stella Pure Gold 600ml", 2000, { groups: [one("Cerveja", ["Corona", "Stella Pure Gold"])] }),
      drink("Amstel 600ml", 1600),
      drink("Original 600ml", 1700),
      drink("IPA 0% álcool Verace 600ml", 1900),
      drink("Brahma Malzbier 350ml", 900),
      drink("Long neck 330ml", 1200, { description: "Pergunte as marcas disponíveis." }),
      drink("Long neck 0% álcool 330ml", 1400),
      drink("Latão 473ml", 1200, { description: "Pergunte as marcas disponíveis." }),
    ],
  },
  {
    name: "Chopes Verace (400ml)",
    items: [
      drink("Lager Premium • Pilsen", 1550, { description: "Clássicos. IBU 13,8 • ABV 4,5%." }),
      drink("Low Carb • Lager", 1550, { description: "Clássicos. 0% carboidratos e 0% açúcares. IBU 13,8 • ABV 4,5%." }),
      drink("German Pils • 1516", 1850, { description: "Especiais. IBU 38 • ABV 4,8%." }),
      drink("Hop Lager • Nice", 1850, { description: "Especiais. IBU 23 • ABV 4,5%." }),
      drink("English Pale Ale • Kings Cross", 1850, { description: "Especiais. IBU 39 • ABV 5,1%." }),
      drink("Witbier • Laranja Mecânica", 1850, { description: "Especiais. IBU 21,4 • ABV 4,9%." }),
      drink("Session IPA • Session Dew", 1850, { description: "Especiais. IBU 40 • ABV 4,0%." }),
      drink("IPA • Syrena", 1850, { description: "Especiais. IBU 65 • ABV 6,5%." }),
      drink("Fruit Beer • Maracutaia", 2050, { description: "Exclusivos. IBU 21,4 • ABV 5,4%." }),
      drink("Sour • Mamangava", 2050, { description: "Exclusivos. Manga e maracujá. IBU 4 • ABV 4,8%." }),
      drink("New England Double IPA • Rapsódia", 2050, { description: "Exclusivos. IBU 85 • ABV 8,2%." }),
      drink("Double IPA • Disturbed", 2050, { description: "Exclusivos. IBU 81 • ABV 8,1%." }),
      drink("Stout • Black Soul", 2050, { description: "Exclusivos, lançamento. IBU 33 • ABV 4,2%." }),
      drink("Rótulos CapaPreta 400ml", 2100, { description: "Cervejaria parceira convidada." }),
      drink("Rótulos Greenhouse 400ml", 2650, { description: "Cervejaria parceira convidada." }),
      drink("Rótulos Octopus 400ml", 3650, { description: "Cervejaria parceira convidada." }),
    ],
  },
  {
    name: "Não alcoólicos",
    items: [
      drink("Água sem gás 500ml", 500),
      drink("Água com gás 500ml", 600),
      drink("Refrigerante lata 350ml", 800, { groups: [one("Sabor", ["Coca-Cola", "Coca-Cola Zero", "Guaraná Antarctica", "Guaraná Antarctica Zero", "Sprite", "Fanta", "Água tônica"])] }),
      drink("Coca-Cola vidro 250ml", 700, { groups: [one("Versão", ["Comum", "Zero"])] }),
      drink("Suco Del Valle 290ml", 700, { description: "Consulte os sabores." }),
      drink("Powerade 500ml", 800, { description: "Consulte os sabores." }),
      drink("H2OH 500ml", 800, { groups: [one("Sabor", ["Tradicional", "Limoneto"])] }),
      drink("Red Bull 250ml", 1500, { description: "Consulte os sabores." }),
      drink("St. Pierre 270ml", 800, { description: "Tônicas saborizadas." }),
      drink("Schweppes vidro 250ml", 700, { groups: [one("Sabor", ["Citrus", "Tônica"])] }),
    ],
  },
  {
    name: "Doses e destilados",
    items: [
      drink("Johnnie Walker Red Label", 2000),
      drink("Johnnie Walker Black Label", 2500),
      drink("Chivas Regal", 2500),
      drink("Jack Daniel's Nº7", 2500),
      drink("Licor 43", 3000),
      drink("Licor Balena", 3000),
      drink("Tanqueray Gin", 3000),
      drink("Gordon's Gin", 2500),
      drink("Cachaça branca", 1000, { groups: [one("Marca", ["51", "Ypióca"])] }),
      drink("Cachaça amarela", 1200, { groups: [one("Marca", ["Seleta", "Salinas"])] }),
      drink("Skol Beats 269ml", 1200),
      drink("Smirnoff Ice 269ml", 1400),
    ],
  },
];
