-- Dados de exemplo (etapa 1): 1 revendedor, 2 restaurantes, 8 mesas cada,
-- cardápio de 20 itens no Brasa Bistrô e um cardápio menor na Cantina da Nonna
-- (o segundo restaurante existe para testar o isolamento entre restaurantes).
--
-- Os usuários da equipe são criados por `npm run db:seed-users`, porque contas
-- do Supabase Auth devem ser criadas pela API de admin, não por SQL.
-- Fotos: Unsplash (https://unsplash.com/license), só para demonstração.

-- Revendedor ----------------------------------------------------------------

insert into public.resellers (id, name, brand_name, primary_color)
values ('10000000-0000-4000-8000-000000000001', 'Revenda Demo', 'Comanda', '#E0552B');

-- Restaurantes (o trigger cria kitchen_settings no modo Equilibrado) --------

insert into public.restaurants (id, reseller_id, name, slug, cover_url) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Brasa Bistrô', 'brasa-bistro',
   'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1600&q=80'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'Cantina da Nonna', 'cantina-da-nonna',
   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1600&q=80');

-- Mesas 1 a 8 em cada restaurante (qr_token aleatório pelo default) ---------

insert into public.tables (restaurant_id, label)
select r.id, n::text
from (values ('20000000-0000-4000-8000-000000000001'::uuid),
             ('20000000-0000-4000-8000-000000000002'::uuid)) as r (id)
cross join generate_series(1, 8) as n;

-- Categorias ----------------------------------------------------------------

insert into public.categories (id, restaurant_id, name, position) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Entradas', 1),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Grelhados', 2),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Pratos da casa', 3),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Bebidas', 4),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'Sobremesas', 5),
  ('30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000002', 'Massas', 1),
  ('30000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000002', 'Bebidas', 2),
  ('30000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000002', 'Sobremesas', 3);

-- Itens ---------------------------------------------------------------------

insert into public.menu_items
  (restaurant_id, category_id, name, description, price_cents, prep_minutes, featured, position, photo_url)
select '20000000-0000-4000-8000-000000000001'::uuid, c.id::uuid, i.name, i.description, i.price_cents,
       i.prep_minutes, i.featured, i.position,
       'https://images.unsplash.com/photo-' || i.photo || '?w=800&q=80'
from (values
  -- Entradas
  ('30000000-0000-4000-8000-000000000001', 'Frango à passarinho', 'Pedaços crocantes com alho dourado e limão.', 3890, 15, false, 1, '1626082927389-6cd097cdc6ec'),
  ('30000000-0000-4000-8000-000000000001', 'Carpaccio de filé', 'Lâminas finas, alcaparras, parmesão e rúcula.', 4200, 8, false, 2, '1504674900247-0877df9cc836'),
  ('30000000-0000-4000-8000-000000000001', 'Poke de salmão', 'Salmão fresco, arroz, abacate e legumes.', 4600, 10, false, 3, '1546069901-ba9599a7e63c'),
  ('30000000-0000-4000-8000-000000000001', 'Salada da casa', 'Folhas, tomate, cebola roxa e azeitonas.', 3200, 8, false, 4, '1540189549336-e6e99c3679fe'),
  -- Grelhados
  ('30000000-0000-4000-8000-000000000002', 'Picanha na brasa', '400 g, servida com farofa da casa e vinagrete.', 8990, 25, true, 1, '1558030006-450675393462'),
  ('30000000-0000-4000-8000-000000000002', 'Ancho grelhado', '350 g de ancho com sal de parrilla.', 9400, 25, false, 2, '1529692236671-f1f6cf9683ba'),
  ('30000000-0000-4000-8000-000000000002', 'Bife de chorizo com fritas', '300 g, batatas fritas e chimichurri.', 7800, 22, false, 3, '1600891964092-4316c288032e'),
  ('30000000-0000-4000-8000-000000000002', 'Costela suína barbecue', 'Assada lentamente, com molho barbecue da casa.', 6900, 30, false, 4, '1544025162-d76694265947'),
  ('30000000-0000-4000-8000-000000000002', 'Frango na brasa', 'Sobrecoxa marinada em limão e ervas, com legumes.', 5400, 20, false, 5, '1598515214211-89d3c73ae83b'),
  ('30000000-0000-4000-8000-000000000002', 'Espetinho misto', 'Carne, frango e linguiça, com farofa e vinagrete.', 4900, 18, false, 6, '1555939594-58d7cb561ad1'),
  -- Pratos da casa
  ('30000000-0000-4000-8000-000000000003', 'Risoto de cogumelos', 'Arbóreo, cogumelos frescos e parmesão.', 6200, 22, true, 1, '1476124369491-e7addf5db371'),
  ('30000000-0000-4000-8000-000000000003', 'Salmão grelhado', 'Com legumes da estação e molho de ervas.', 7400, 20, false, 2, '1611599537845-1c7aca0091c0'),
  ('30000000-0000-4000-8000-000000000003', 'Camarão ao molho de coco', 'Camarões, leite de coco, dendê e arroz branco.', 8200, 25, false, 3, '1559847844-5315695dadae'),
  ('30000000-0000-4000-8000-000000000003', 'Fettuccine ao ragu de costela', 'Massa fresca com ragu de costela desfiada.', 5800, 18, false, 4, '1551183053-bf91a1d81141'),
  -- Bebidas
  ('30000000-0000-4000-8000-000000000004', 'Caipirinha de limão', 'Limão taiti, açúcar e o destilado da sua escolha.', 2800, 5, false, 1, '1551538827-9c037cb4f32a'),
  ('30000000-0000-4000-8000-000000000004', 'Drinque da casa', 'Bourbon, laranja e especiarias.', 3400, 5, false, 2, '1514362545857-3bc16c4c7d1b'),
  ('30000000-0000-4000-8000-000000000004', 'Suco de laranja', 'Natural, 400 ml.', 1400, 4, false, 3, '1600271886742-f049cd451bba'),
  ('30000000-0000-4000-8000-000000000004', 'Chope artesanal', 'Pilsen da casa, 400 ml.', 1900, 2, false, 4, '1608270586620-248524c67de9'),
  -- Sobremesas
  ('30000000-0000-4000-8000-000000000005', 'Brownie com sorvete', 'Brownie de chocolate meio amargo e sorvete de creme.', 2900, 8, false, 1, '1606313564200-e75d5e30476c'),
  ('30000000-0000-4000-8000-000000000005', 'Tiramisù', 'Café, mascarpone e cacau.', 3200, 3, false, 2, '1571877227200-a0d98ea607e9')
) as i (category, name, description, price_cents, prep_minutes, featured, position, photo)
join public.categories c on c.id = i.category::uuid;

insert into public.menu_items
  (restaurant_id, category_id, name, description, price_cents, prep_minutes, featured, position, photo_url)
values
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000011', 'Penne ao sugo', 'Molho de tomate italiano e manjericão.', 4200, 15, true, 1,
   'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=800&q=80'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000011', 'Farfalle ao pesto', 'Pesto de manjericão e tomate-cereja.', 4400, 15, false, 2,
   'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=800&q=80'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000011', 'Pizza de calabresa', 'Massa de longa fermentação, calabresa e cebola.', 5900, 20, false, 3,
   'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000012', 'Água com gás', '500 ml.', 800, 1, false, 1, null),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000013', 'Panna cotta', 'Com calda de frutas vermelhas.', 2400, 3, false, 1,
   'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&q=80');

-- Grupos de adicionais ------------------------------------------------------

insert into public.modifier_groups (menu_item_id, name, required, min_select, max_select, position)
select mi.id, g.name, g.required, g.min_select, g.max_select, g.position
from (values
  ('Picanha na brasa', 'Ponto da carne', true, 1, 1, 1),
  ('Picanha na brasa', 'Acompanhamentos', false, 0, 2, 2),
  ('Ancho grelhado', 'Ponto da carne', true, 1, 1, 1),
  ('Bife de chorizo com fritas', 'Ponto da carne', true, 1, 1, 1),
  ('Frango à passarinho', 'Molhos', false, 0, 2, 1),
  ('Caipirinha de limão', 'Destilado', true, 1, 1, 1),
  ('Brownie com sorvete', 'Adicional', false, 0, 1, 1)
) as g (item, name, required, min_select, max_select, position)
join public.menu_items mi
  on mi.name = g.item and mi.restaurant_id = '20000000-0000-4000-8000-000000000001';

insert into public.modifiers (group_id, name, price_cents, position)
select mg.id, m.name, m.price_cents, m.position
from (values
  ('Ponto da carne', 'Mal passada', 0, 1),
  ('Ponto da carne', 'Ao ponto', 0, 2),
  ('Ponto da carne', 'Bem passada', 0, 3),
  ('Acompanhamentos', 'Arroz biro-biro', 1200, 1),
  ('Acompanhamentos', 'Batata rústica', 1400, 2),
  ('Acompanhamentos', 'Mandioca frita', 1200, 3),
  ('Molhos', 'Maionese da casa', 0, 1),
  ('Molhos', 'Barbecue', 0, 2),
  ('Destilado', 'Cachaça', 0, 1),
  ('Destilado', 'Vodka', 400, 2),
  ('Destilado', 'Saquê', 500, 3),
  ('Adicional', 'Calda de chocolate', 500, 1)
) as m (grp, name, price_cents, position)
join public.modifier_groups mg on mg.name = m.grp
join public.menu_items mi
  on mi.id = mg.menu_item_id and mi.restaurant_id = '20000000-0000-4000-8000-000000000001';
