-- GestorMobile — lado cliente e aprovação de pedidos pela equipa.
-- Executar depois de referrals_and_vouchers.sql no SQL Editor do Supabase.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'staff', 'customer'));
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'customer';

CREATE OR REPLACE FUNCTION public.customer_commerce_available()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path='' AS $$ SELECT TRUE; $$;
REVOKE ALL ON FUNCTION public.customer_commerce_available() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_commerce_available() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'customer');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.is_team()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'staff')
  );
$$;
REVOKE ALL ON FUNCTION private.is_team() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_team() TO authenticated;

DROP POLICY IF EXISTS "Profiles são visíveis para utilizadores autenticados" ON public.profiles;
CREATE POLICY "Perfil próprio ou equipa" ON public.profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT private.is_team()));

CREATE TABLE IF NOT EXISTS public.customer_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('MB Way', 'Transferência', 'Stripe')),
  customer_phone TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  referral_code TEXT,
  voucher_id UUID REFERENCES public.vouchers(id),
  original_total NUMERIC(10,2) NOT NULL CHECK (original_total >= 0),
  final_total NUMERIC(10,2) NOT NULL CHECK (final_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.profiles(id),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.customer_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES public.product_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(10,2) NOT NULL CHECK (line_total >= 0)
);

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS reserved_order_id UUID REFERENCES public.customer_orders(id);
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_reserved_order_unique
  ON public.vouchers(reserved_order_id) WHERE reserved_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_orders_customer_idx ON public.customer_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_orders_pending_idx ON public.customer_orders(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS customer_order_items_order_idx ON public.customer_order_items(order_id);
CREATE INDEX IF NOT EXISTS customer_order_items_variant_idx ON public.customer_order_items(product_variant_id);

ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente consulta os seus pedidos" ON public.customer_orders;
CREATE POLICY "Cliente consulta os seus pedidos" ON public.customer_orders
FOR SELECT TO authenticated
USING (customer_id = (SELECT auth.uid()) OR (SELECT private.is_team()));

DROP POLICY IF EXISTS "Cliente consulta os artigos dos seus pedidos" ON public.customer_order_items;
CREATE POLICY "Cliente consulta os artigos dos seus pedidos" ON public.customer_order_items
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.customer_orders o
  WHERE o.id = order_id
    AND (o.customer_id = (SELECT auth.uid()) OR (SELECT private.is_team()))
));

GRANT SELECT ON public.customer_orders, public.customer_order_items TO authenticated;

-- Clientes nunca escrevem diretamente nestas tabelas: usam RPCs atómicas.
DROP POLICY IF EXISTS "Todos podem inserir vendas" ON public.sales;
CREATE POLICY "Equipa insere vendas" ON public.sales FOR INSERT TO authenticated
WITH CHECK ((SELECT private.is_team()));
DROP POLICY IF EXISTS "Todos podem inserir reservas" ON public.reservations;
CREATE POLICY "Equipa insere reservas" ON public.reservations FOR INSERT TO authenticated
WITH CHECK ((SELECT private.is_team()));
DROP POLICY IF EXISTS "Reservas visíveis para todos os autenticados" ON public.reservations;
CREATE POLICY "Equipa consulta reservas" ON public.reservations FOR SELECT TO authenticated
USING ((SELECT private.is_team()));
DROP POLICY IF EXISTS "Todos podem atualizar reservas" ON public.reservations;
CREATE POLICY "Equipa atualiza reservas" ON public.reservations FOR UPDATE TO authenticated
USING ((SELECT private.is_team())) WITH CHECK ((SELECT private.is_team()));
DROP POLICY IF EXISTS "Todos podem apagar reservas (ao converter em venda)" ON public.reservations;
CREATE POLICY "Equipa remove reservas" ON public.reservations FOR DELETE TO authenticated
USING ((SELECT private.is_team()));

-- Fecha o endpoint legado de sincronização a clientes, mantendo o modo offline da equipa.
CREATE OR REPLACE FUNCTION public.process_sale(
  p_local_id UUID, p_customer_name VARCHAR, p_product_variant_id UUID,
  p_quantity INT, p_total_price DECIMAL, p_payment_method VARCHAR,
  p_sale_date TIMESTAMPTZ, p_created_by UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_stock INT; v_sale_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT (SELECT private.is_team()) THEN
    RAISE EXCEPTION 'Apenas a equipa pode registar vendas.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_total_price < 0
     OR p_payment_method NOT IN ('Dinheiro', 'MB Way', 'Transferência', 'Stripe') THEN
    RAISE EXCEPTION 'Venda inválida.';
  END IF;
  SELECT id INTO v_sale_id FROM public.sales WHERE local_id=p_local_id;
  IF v_sale_id IS NOT NULL THEN RETURN json_build_object('success',TRUE,'sale_id',v_sale_id); END IF;
  SELECT stock_quantity INTO v_stock FROM public.product_variants
  WHERE id=p_product_variant_id AND is_active=TRUE FOR UPDATE;
  IF v_stock IS NULL OR v_stock < p_quantity THEN
    RETURN json_build_object('success',FALSE,'error','Stock insuficiente.');
  END IF;
  UPDATE public.product_variants SET stock_quantity=stock_quantity-p_quantity WHERE id=p_product_variant_id;
  INSERT INTO public.sales(local_id,customer_name,product_variant_id,quantity,total_price,payment_method,sale_date,sync_status,created_by)
  VALUES(p_local_id,NULLIF(TRIM(p_customer_name),''),p_product_variant_id,p_quantity,p_total_price,p_payment_method,
    COALESCE(p_sale_date,NOW()),'synced',auth.uid()) RETURNING id INTO v_sale_id;
  RETURN json_build_object('success',TRUE,'sale_id',v_sale_id);
END;
$$;

-- As reservas internas continuam disponíveis à equipa, mas nunca ao cliente.
CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_reservation public.reservations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (SELECT private.is_team()) THEN RAISE EXCEPTION 'Apenas a equipa pode alterar reservas.'; END IF;
  SELECT * INTO v_reservation FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.status <> 'Pendente' THEN RETURN json_build_object('success',FALSE,'error','Reserva não encontrada ou já tratada.'); END IF;
  UPDATE public.product_variants SET stock_quantity=stock_quantity+v_reservation.quantity WHERE id=v_reservation.product_variant_id;
  UPDATE public.reservations SET status='Cancelada' WHERE id=p_reservation_id;
  RETURN json_build_object('success',TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_reservation_to_sale(p_reservation_id UUID,p_payment_method VARCHAR)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_reservation public.reservations%ROWTYPE; v_sale_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT (SELECT private.is_team()) THEN RAISE EXCEPTION 'Apenas a equipa pode confirmar reservas.'; END IF;
  IF p_payment_method NOT IN ('Dinheiro','MB Way','Transferência','Stripe') THEN RETURN json_build_object('success',FALSE,'error','Método inválido.'); END IF;
  SELECT * INTO v_reservation FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.status <> 'Pendente' THEN RETURN json_build_object('success',FALSE,'error','Reserva não encontrada ou já tratada.'); END IF;
  INSERT INTO public.sales(local_id,customer_name,product_variant_id,quantity,total_price,payment_method,sale_date,sync_status,created_by)
  VALUES(uuid_generate_v4(),v_reservation.customer_name,v_reservation.product_variant_id,v_reservation.quantity,
    v_reservation.total_price,p_payment_method,NOW(),'synced',auth.uid()) RETURNING id INTO v_sale_id;
  DELETE FROM public.reservations WHERE id=p_reservation_id;
  RETURN json_build_object('success',TRUE,'sale_id',v_sale_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_items JSONB,
  p_payment_method TEXT,
  p_customer_phone TEXT,
  p_delivery_address TEXT,
  p_referral_code TEXT DEFAULT NULL,
  p_voucher_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order_id UUID := uuid_generate_v4();
  v_item RECORD;
  v_variant public.product_variants%ROWTYPE;
  v_voucher public.vouchers%ROWTYPE;
  v_referrer UUID;
  v_original NUMERIC(10,2) := 0;
  v_total_quantity INTEGER := 0;
  v_final NUMERIC(10,2);
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_user_id AND role = 'customer'
  ) THEN RAISE EXCEPTION 'Apenas clientes podem submeter pedidos.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrinho inválido.';
  END IF;
  IF p_payment_method NOT IN ('MB Way', 'Transferência', 'Stripe') THEN
    RAISE EXCEPTION 'Método de pagamento inválido.';
  END IF;
  IF NULLIF(TRIM(p_customer_phone), '') IS NULL OR NULLIF(TRIM(p_delivery_address), '') IS NULL THEN
    RAISE EXCEPTION 'Contacto e morada de entrega são obrigatórios.';
  END IF;

  IF NULLIF(UPPER(TRIM(p_referral_code)), '') IS NOT NULL THEN
    SELECT id INTO v_referrer FROM public.profiles
    WHERE UPPER(referral_code) = UPPER(TRIM(p_referral_code));
    IF v_referrer IS NULL THEN RAISE EXCEPTION 'Código de amigo não encontrado.'; END IF;
    IF v_referrer = v_user_id THEN RAISE EXCEPTION 'Não podes utilizar o teu próprio código.'; END IF;
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(product_variant_id UUID, quantity INTEGER)
    ORDER BY product_variant_id
  LOOP
    IF v_item.product_variant_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Existe um artigo inválido no carrinho.';
    END IF;
    SELECT * INTO v_variant FROM public.product_variants
    WHERE id = v_item.product_variant_id AND is_active = TRUE FOR UPDATE;
    IF NOT FOUND OR v_variant.stock_quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para um dos artigos.';
    END IF;
    v_original := v_original + ROUND(v_variant.base_price * v_item.quantity, 2);
    v_total_quantity := v_total_quantity + v_item.quantity;
  END LOOP;

  IF p_voucher_id IS NOT NULL THEN
    SELECT * INTO v_voucher FROM public.vouchers
    WHERE id = p_voucher_id AND user_id = v_user_id AND is_used = FALSE
      AND revoked_at IS NULL AND reserved_order_id IS NULL AND expires_at > NOW()
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Voucher inválido, expirado ou indisponível.'; END IF;
    IF jsonb_array_length(p_items) <> 1 OR v_total_quantity <> 1 THEN
      RAISE EXCEPTION 'O voucher de 15€ só pode ser aplicado a uma camisola.';
    END IF;
  END IF;
  v_final := CASE WHEN p_voucher_id IS NOT NULL THEN 15.00 ELSE v_original END;

  INSERT INTO public.customer_orders(
    id, customer_id, payment_method, customer_phone, delivery_address,
    referral_code, voucher_id, original_total, final_total
  ) VALUES (
    v_order_id, v_user_id, p_payment_method, TRIM(p_customer_phone), TRIM(p_delivery_address),
    NULLIF(UPPER(TRIM(p_referral_code)), ''),
    p_voucher_id, v_original, v_final
  );

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(product_variant_id UUID, quantity INTEGER)
    ORDER BY product_variant_id
  LOOP
    SELECT * INTO v_variant FROM public.product_variants
    WHERE id = v_item.product_variant_id FOR UPDATE;
    UPDATE public.product_variants SET stock_quantity = stock_quantity - v_item.quantity
    WHERE id = v_item.product_variant_id;
    INSERT INTO public.customer_order_items(order_id, product_variant_id, quantity, unit_price, line_total)
    VALUES (v_order_id, v_item.product_variant_id, v_item.quantity, v_variant.base_price,
      ROUND(v_variant.base_price * v_item.quantity, 2));
  END LOOP;
  IF p_voucher_id IS NOT NULL THEN
    UPDATE public.vouchers SET reserved_order_id = v_order_id WHERE id = p_voucher_id;
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'order_id', v_order_id, 'status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_customer_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.customer_orders%ROWTYPE;
  v_item RECORD;
  v_event UUID;
  v_referrer UUID;
  v_old_count INTEGER;
  v_new_count INTEGER;
  v_quantity INTEGER;
  v_rewards INTEGER;
  i INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT (SELECT private.is_team()) THEN
    RAISE EXCEPTION 'Apenas a equipa pode confirmar pedidos.';
  END IF;
  SELECT * INTO v_order FROM public.customer_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já tratado.'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_quantity FROM public.customer_order_items WHERE order_id = p_order_id;
  FOR v_item IN SELECT * FROM public.customer_order_items WHERE order_id = p_order_id ORDER BY product_variant_id
  LOOP
    INSERT INTO public.sales(
      local_id, checkout_id, customer_name, product_variant_id, quantity, original_total_price,
      total_price, payment_method, sale_date, sync_status, created_by, voucher_id
    ) VALUES (
      uuid_generate_v4(), p_order_id,
      (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = v_order.customer_id),
      v_item.product_variant_id, v_item.quantity, v_item.line_total,
      CASE WHEN v_order.voucher_id IS NOT NULL THEN 15.00 ELSE v_item.line_total END,
      v_order.payment_method, NOW(), 'synced', auth.uid(), v_order.voucher_id
    );
  END LOOP;

  IF v_order.voucher_id IS NOT NULL THEN
    UPDATE public.vouchers SET is_used = TRUE, used_at = NOW(), reserved_order_id = NULL
    WHERE id = v_order.voucher_id AND reserved_order_id = p_order_id;
  END IF;
  IF v_order.referral_code IS NOT NULL THEN
    SELECT id INTO v_referrer FROM public.profiles WHERE UPPER(referral_code) = UPPER(v_order.referral_code);
    IF v_referrer IS NOT NULL AND v_referrer <> v_order.customer_id THEN
      INSERT INTO public.referral_events(checkout_id, referrer_id, buyer_id, shirt_quantity)
      VALUES (p_order_id, v_referrer, v_order.customer_id, v_quantity) RETURNING id INTO v_event;
      SELECT referral_count INTO v_old_count FROM public.profiles WHERE id = v_referrer FOR UPDATE;
      UPDATE public.profiles SET referral_count = referral_count + v_quantity WHERE id = v_referrer
      RETURNING referral_count INTO v_new_count;
      UPDATE public.sales SET referral_event_id = v_event WHERE checkout_id = p_order_id;
      v_rewards := FLOOR(v_new_count / 2.0) - FLOOR(v_old_count / 2.0);
      FOR i IN 1..v_rewards LOOP
        INSERT INTO public.vouchers(user_id, code, expires_at, discount_type, referral_event_id)
        VALUES (v_referrer, 'V15-' || UPPER(SUBSTRING(REPLACE(uuid_generate_v4()::TEXT, '-', '') FROM 1 FOR 10)),
          NOW() + INTERVAL '90 days', 'FIXED_PRICE_15', v_event);
      END LOOP;
    END IF;
  END IF;
  UPDATE public.customer_orders SET status='confirmed', confirmed_at=NOW(), confirmed_by=auth.uid()
  WHERE id=p_order_id;
  RETURN jsonb_build_object('success', TRUE, 'order_id', p_order_id, 'shirts_credited', COALESCE(v_quantity,0));
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_customer_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.customer_orders%ROWTYPE;
  v_item RECORD;
BEGIN
  SELECT * INTO v_order FROM public.customer_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'pending' THEN RAISE EXCEPTION 'Pedido não encontrado ou já tratado.'; END IF;
  IF auth.uid() IS NULL OR (v_order.customer_id <> auth.uid() AND NOT (SELECT private.is_team())) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar este pedido.';
  END IF;
  FOR v_item IN SELECT * FROM public.customer_order_items WHERE order_id=p_order_id ORDER BY product_variant_id
  LOOP
    UPDATE public.product_variants SET stock_quantity=stock_quantity+v_item.quantity
    WHERE id=v_item.product_variant_id;
  END LOOP;
  UPDATE public.vouchers SET reserved_order_id=NULL WHERE reserved_order_id=p_order_id AND is_used=FALSE;
  UPDATE public.customer_orders SET status='cancelled', cancelled_at=NOW(), cancelled_by=auth.uid()
  WHERE id=p_order_id;
  RETURN jsonb_build_object('success', TRUE, 'order_id', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_order(JSONB, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_customer_order(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_customer_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_order(JSONB, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_customer_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_order(UUID) TO authenticated;
