-- Each restaurant can override the reseller palette without changing other restaurants.
-- Existing RLS and manager update guards apply to these presentation-only fields.
alter table public.restaurants
  add column primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column background_color text check (background_color ~ '^#[0-9a-fA-F]{6}$');
