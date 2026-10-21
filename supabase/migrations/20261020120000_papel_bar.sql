-- Fase 2, etapa 1: novo papel "bar" (spec-fase2.md, seções 9 e 10).
-- Fica em migration própria porque o Postgres não deixa usar um valor de enum
-- recém-criado na mesma transação em que ele foi adicionado.
alter type public.member_role add value if not exists 'bar';
