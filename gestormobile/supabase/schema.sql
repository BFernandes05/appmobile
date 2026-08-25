-- ============================================================
-- GestorMobile — Schema Supabase / PostgreSQL
-- Copiar e executar no SQL Editor do Supabase
-- ============================================================

-- Extensão para UUIDs automáticos
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELA: profiles (ligada ao Supabase Auth)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       VARCHAR NOT NULL,
  full_name   VARCHAR,
  role        VARCHAR NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: criar perfil automaticamente ao registar utilizador
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'staff'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Esta função existe apenas para o trigger interno de Auth.
-- Não deve poder ser chamada diretamente pela API.
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- TABELA: products (Catálogo de Camisolas)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR NOT NULL,
  category    VARCHAR NOT NULL, -- ex: Home, Away, Third, Retro
  image_url   TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- TABELA: product_variants (Tamanhos e Stock)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_variants (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size             VARCHAR NOT NULL,
  base_price       DECIMAL(10, 2) NOT NULL,
  stock_quantity   INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON product_variants;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- TABELA: reservations (Sistema de Reservas)
-- ============================================================
CREATE TABLE IF NOT EXISTS reservations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_name        VARCHAR NOT NULL,
  customer_contact     VARCHAR,
  product_variant_id   UUID NOT NULL REFERENCES product_variants(id),
  quantity             INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_price          DECIMAL(10, 2) NOT NULL,
  status               VARCHAR NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Confirmada', 'Cancelada')),
  reservation_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_by           UUID REFERENCES profiles(id)
);

-- Trigger: decrementar stock ao criar reserva
CREATE OR REPLACE FUNCTION decrement_stock_on_reservation()
RETURNS TRIGGER AS $$
BEGIN
  -- Verificar se há stock suficiente
  IF (SELECT stock_quantity FROM public.product_variants WHERE id = NEW.product_variant_id FOR UPDATE) < NEW.quantity THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponível: % unidade(s).',
      (SELECT stock_quantity FROM public.product_variants WHERE id = NEW.product_variant_id);
  END IF;

  -- Decrementar o stock
  UPDATE public.product_variants
  SET stock_quantity = stock_quantity - NEW.quantity
  WHERE id = NEW.product_variant_id;

  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS on_reservation_created ON reservations;
CREATE TRIGGER on_reservation_created
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION decrement_stock_on_reservation();


-- ============================================================
-- TABELA: sales (Histórico de Vendas)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_name             VARCHAR,
  product_variant_id        UUID NOT NULL REFERENCES product_variants(id),
  quantity                  INT NOT NULL CHECK (quantity > 0),
  total_price               DECIMAL(10, 2) NOT NULL,
  payment_method            VARCHAR NOT NULL CHECK (payment_method IN ('Dinheiro', 'MB Way', 'Transferência', 'Stripe')),
  stripe_payment_intent_id  VARCHAR,
  sale_date                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_status               VARCHAR NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('pending', 'synced', 'error')),
  local_id                  UUID UNIQUE,
  created_by                UUID REFERENCES profiles(id)
);

-- Trigger: decrementar stock ao criar venda direta (não via reserva)
CREATE OR REPLACE FUNCTION decrement_stock_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- Verificar stock (apenas se local_id for nulo — venda online direta)
  IF NEW.local_id IS NULL THEN
    IF (SELECT stock_quantity FROM product_variants WHERE id = NEW.product_variant_id) < NEW.quantity THEN
      RAISE EXCEPTION 'Stock insuficiente. Disponível: % unidade(s).',
        (SELECT stock_quantity FROM product_variants WHERE id = NEW.product_variant_id);
    END IF;

    UPDATE product_variants
    SET stock_quantity = stock_quantity - NEW.quantity
    WHERE id = NEW.product_variant_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_sale_created ON sales;
CREATE TRIGGER on_sale_created
  BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION decrement_stock_on_sale();


-- ============================================================
-- RPC: process_sale (para sync offline)
-- Verifica stock atomicamente no servidor e cria a venda
-- ============================================================
CREATE OR REPLACE FUNCTION process_sale(
  p_local_id              UUID,
  p_customer_name         VARCHAR,
  p_product_variant_id    UUID,
  p_quantity              INT,
  p_total_price           DECIMAL,
  p_payment_method        VARCHAR,
  p_sale_date             TIMESTAMPTZ,
  p_created_by            UUID
)
RETURNS JSON AS $$
DECLARE
  v_stock INT;
  v_sale_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada.';
  END IF;

  -- Um retry da mesma venda tem de ser idempotente e nunca descontar stock novamente.
  SELECT id INTO v_sale_id FROM public.sales WHERE local_id = p_local_id;
  IF v_sale_id IS NOT NULL THEN
    RETURN json_build_object('success', true, 'sale_id', v_sale_id);
  END IF;

  -- Bloquear a linha para evitar race conditions
  SELECT stock_quantity INTO v_stock
  FROM public.product_variants
  WHERE id = p_product_variant_id
  FOR UPDATE;

  IF v_stock < p_quantity THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Stock insuficiente. Disponível: %s unidade(s).', v_stock)
    );
  END IF;

  -- Decrementar stock
  UPDATE public.product_variants
  SET stock_quantity = stock_quantity - p_quantity
  WHERE id = p_product_variant_id;

  -- Inserir venda (sem trigger de stock pois local_id não é nulo)
  INSERT INTO public.sales (
    local_id, customer_name, product_variant_id,
    quantity, total_price, payment_method,
    sale_date, sync_status, created_by
  ) VALUES (
    p_local_id, p_customer_name, p_product_variant_id,
    p_quantity, p_total_price, p_payment_method,
    p_sale_date, 'synced', auth.uid()
  )
  ON CONFLICT (local_id) DO NOTHING
  RETURNING id INTO v_sale_id;

  RETURN json_build_object('success', true, 'sale_id', v_sale_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Cancelar uma reserva e repor o stock numa única transação.
CREATE OR REPLACE FUNCTION cancel_reservation(p_reservation_id UUID)
RETURNS JSON AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada.';
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Reserva não encontrada.');
  END IF;
  IF v_reservation.status <> 'Pendente' THEN
    RETURN json_build_object('success', false, 'error', 'A reserva já não está pendente.');
  END IF;

  UPDATE public.product_variants
  SET stock_quantity = stock_quantity + v_reservation.quantity
  WHERE id = v_reservation.product_variant_id;

  UPDATE public.reservations SET status = 'Cancelada' WHERE id = p_reservation_id;
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Converter sem voltar a descontar stock: a reserva já o bloqueou na criação.
CREATE OR REPLACE FUNCTION convert_reservation_to_sale(
  p_reservation_id UUID,
  p_payment_method VARCHAR
)
RETURNS JSON AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_sale_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada.';
  END IF;
  IF p_payment_method NOT IN ('Dinheiro', 'MB Way', 'Transferência', 'Stripe') THEN
    RETURN json_build_object('success', false, 'error', 'Método de pagamento inválido.');
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Reserva não encontrada.');
  END IF;
  IF v_reservation.status <> 'Pendente' THEN
    RETURN json_build_object('success', false, 'error', 'A reserva já não está pendente.');
  END IF;

  INSERT INTO public.sales (
    local_id, customer_name, product_variant_id, quantity,
    total_price, payment_method, sale_date, sync_status, created_by
  ) VALUES (
    uuid_generate_v4(), v_reservation.customer_name, v_reservation.product_variant_id,
    v_reservation.quantity, v_reservation.total_price, p_payment_method,
    NOW(), 'synced', auth.uid()
  ) RETURNING id INTO v_sale_id;

  DELETE FROM public.reservations WHERE id = p_reservation_id;
  RETURN json_build_object('success', true, 'sale_id', v_sale_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION process_sale(UUID, VARCHAR, UUID, INT, DECIMAL, VARCHAR, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cancel_reservation(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION convert_reservation_to_sale(UUID, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION process_sale(UUID, VARCHAR, UUID, INT, DECIMAL, VARCHAR, TIMESTAMPTZ, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_reservation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION convert_reservation_to_sale(UUID, VARCHAR) TO authenticated;


-- ============================================================
-- CRON: Expiração automática de reservas ao fim de 24h
-- Requer extensão pg_cron (activar em Database > Extensions)
-- ============================================================
-- Executar APENAS após activar pg_cron em Database > Extensions:
/*
SELECT cron.schedule(
  'expire-reservations',
  '0 * * * *',  -- a cada hora
  $$
    UPDATE reservations
    SET status = 'Cancelada'
    WHERE status = 'Pendente'
      AND expires_at < NOW();

    UPDATE product_variants pv
    SET stock_quantity = pv.stock_quantity + r.quantity
    FROM reservations r
    WHERE r.product_variant_id = pv.id
      AND r.status = 'Cancelada'
      AND r.expires_at < NOW()
      AND r.expires_at > NOW() - INTERVAL '1 hour';
  $$
);
*/


-- ============================================================
-- VIEW: Totais mensais para dashboard
-- ============================================================
CREATE OR REPLACE VIEW monthly_sales_summary WITH (security_invoker = true) AS
SELECT
  DATE_TRUNC('month', sale_date AT TIME ZONE 'Europe/Lisbon') AS month,
  COUNT(*) AS total_sales,
  SUM(total_price) AS total_revenue
FROM sales
WHERE sync_status = 'synced'
GROUP BY 1
ORDER BY 1 DESC;
