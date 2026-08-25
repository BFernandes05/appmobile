-- ============================================================
-- GestorMobile — Row Level Security (RLS) Policies
-- Executar após o schema.sql
-- ============================================================

-- Ativar RLS em todas as tabelas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

-- ------------------------------------------------------------
-- PROFILES
-- Leitura: qualquer pessoa vê (útil para joins)
-- Escrita: apenas admin (evita que um utilizador altere a própria role)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Profiles são visíveis para utilizadores autenticados" ON profiles;
DROP POLICY IF EXISTS "Admin pode atualizar perfis" ON profiles;
DROP POLICY IF EXISTS "Utilizador pode atualizar o próprio perfil" ON profiles;
CREATE POLICY "Profiles são visíveis para utilizadores autenticados"
ON profiles FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (SELECT private.is_admin())
);

CREATE POLICY "Admin pode atualizar perfis"
ON profiles FOR UPDATE TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

-- ------------------------------------------------------------
-- PRODUCTS & VARIANTS
-- Leitura: todos os autenticados
-- Escrita: apenas admins
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Produtos visíveis para todos os autenticados" ON products;
DROP POLICY IF EXISTS "Admins podem inserir produtos" ON products;
DROP POLICY IF EXISTS "Admins podem atualizar produtos" ON products;
DROP POLICY IF EXISTS "Variantes visíveis para todos os autenticados" ON product_variants;
DROP POLICY IF EXISTS "Admins podem inserir variantes" ON product_variants;
DROP POLICY IF EXISTS "Admins podem atualizar variantes" ON product_variants;
CREATE POLICY "Produtos visíveis para todos os autenticados"
ON products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins podem inserir produtos"
ON products FOR INSERT TO authenticated
WITH CHECK ((SELECT private.is_admin()));

CREATE POLICY "Admins podem atualizar produtos"
ON products FOR UPDATE TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

CREATE POLICY "Variantes visíveis para todos os autenticados"
ON product_variants FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins podem inserir variantes"
ON product_variants FOR INSERT TO authenticated
WITH CHECK ((SELECT private.is_admin()));

CREATE POLICY "Admins podem atualizar variantes"
ON product_variants FOR UPDATE TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

-- ------------------------------------------------------------
-- RESERVATIONS
-- Leitura: todos os autenticados
-- Escrita: todos os autenticados (admin ou staff)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Reservas visíveis para todos os autenticados" ON reservations;
DROP POLICY IF EXISTS "Todos podem inserir reservas" ON reservations;
DROP POLICY IF EXISTS "Todos podem atualizar reservas" ON reservations;
DROP POLICY IF EXISTS "Todos podem apagar reservas (ao converter em venda)" ON reservations;
CREATE POLICY "Reservas visíveis para todos os autenticados"
ON reservations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Todos podem inserir reservas"
ON reservations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Todos podem atualizar reservas"
ON reservations FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Todos podem apagar reservas (ao converter em venda)"
ON reservations FOR DELETE TO authenticated USING (true);

-- ------------------------------------------------------------
-- SALES
-- Leitura: Admin vê tudo. Staff só vê as suas.
-- Escrita: todos os autenticados (admin ou staff)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Staff vê apenas as suas vendas, Admin vê todas" ON sales;
DROP POLICY IF EXISTS "Todos podem inserir vendas" ON sales;
DROP POLICY IF EXISTS "Apenas admin pode alterar/apagar vendas (ex: corrigir erro)" ON sales;
DROP POLICY IF EXISTS "Apenas admin pode apagar vendas" ON sales;
CREATE POLICY "Staff vê apenas as suas vendas, Admin vê todas"
ON sales FOR SELECT TO authenticated
USING (
  ((SELECT private.is_admin()))
  OR
  (created_by = auth.uid())
);

CREATE POLICY "Todos podem inserir vendas"
ON sales FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Apenas admin pode alterar/apagar vendas (ex: corrigir erro)"
ON sales FOR UPDATE TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

CREATE POLICY "Apenas admin pode apagar vendas"
ON sales FOR DELETE TO authenticated
USING ((SELECT private.is_admin()));

-- ------------------------------------------------------------
-- STORAGE BUCKET (product-images)
-- Política para o bucket de imagens
-- ------------------------------------------------------------
-- Nota: Tens de criar o bucket 'product-images' manualmente no Dashboard e marcá-lo como Public.
-- Depois corre estas políticas:

DROP POLICY IF EXISTS "Imagens públicas" ON storage.objects;
DROP POLICY IF EXISTS "Admins podem fazer upload de imagens" ON storage.objects;
DROP POLICY IF EXISTS "Admins podem editar/apagar imagens" ON storage.objects;
DROP POLICY IF EXISTS "Admins podem apagar imagens" ON storage.objects;

-- Leitura pública do bucket 'product-images'
CREATE POLICY "Imagens públicas"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Inserção de imagens: apenas Admins
CREATE POLICY "Admins podem fazer upload de imagens"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images' AND 
  (SELECT private.is_admin())
);

-- Atualização e Apagar: apenas Admins
CREATE POLICY "Admins podem editar/apagar imagens"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images' AND 
  (SELECT private.is_admin())
);
CREATE POLICY "Admins podem apagar imagens"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images' AND 
  (SELECT private.is_admin())
);
