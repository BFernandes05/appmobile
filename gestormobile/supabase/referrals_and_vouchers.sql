-- GestorMobile — referrals, vouchers e checkout atómico
-- Aplicar no SQL Editor do projeto Supabase do GestorMobile.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0;

UPDATE public.profiles
SET referral_code = 'RB-' || UPPER(SUBSTRING(REPLACE(id::TEXT, '-', '') FROM 1 FOR 12))
WHERE referral_code IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN referral_code SET DEFAULT (
    'RB-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 12))
  ),
  ALTER COLUMN referral_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_unique
  ON public.profiles (UPPER(referral_code));

CREATE TABLE IF NOT EXISTS public.referral_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id UUID NOT NULL UNIQUE,
  referrer_id UUID NOT NULL REFERENCES public.profiles(id),
  buyer_id UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  CHECK (referrer_id <> buyer_id)
);

ALTER TABLE public.referral_events
  ADD COLUMN IF NOT EXISTS shirt_quantity INTEGER NOT NULL DEFAULT 1
  CHECK (shirt_quantity > 0);

CREATE TABLE IF NOT EXISTS public.vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'FIXED_PRICE_15'
    CHECK (discount_type = 'FIXED_PRICE_15'),
  referral_event_id UUID UNIQUE REFERENCES public.referral_events(id),
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma compra com 4 camisolas pode gerar 2 vouchers no mesmo evento.
ALTER TABLE public.vouchers
  DROP CONSTRAINT IF EXISTS vouchers_referral_event_id_key;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS checkout_id UUID,
  ADD COLUMN IF NOT EXISTS original_total_price DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS referral_event_id UUID REFERENCES public.referral_events(id),
  ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES public.vouchers(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sales_checkout_id_idx ON public.sales(checkout_id);
CREATE INDEX IF NOT EXISTS sales_referral_event_id_idx ON public.sales(referral_event_id);
CREATE INDEX IF NOT EXISTS sales_voucher_id_idx ON public.sales(voucher_id);
CREATE INDEX IF NOT EXISTS referral_events_referrer_id_idx ON public.referral_events(referrer_id);
CREATE INDEX IF NOT EXISTS referral_events_buyer_id_idx ON public.referral_events(buyer_id);
CREATE INDEX IF NOT EXISTS vouchers_user_id_idx ON public.vouchers(user_id);
CREATE INDEX IF NOT EXISTS vouchers_user_available_idx
  ON public.vouchers(user_id, is_used, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Utilizadores consultam os seus referrals" ON public.referral_events;
CREATE POLICY "Utilizadores consultam os seus referrals"
ON public.referral_events FOR SELECT TO authenticated
USING (
  referrer_id = (SELECT auth.uid())
  OR buyer_id = (SELECT auth.uid())
  OR (SELECT private.is_admin())
);

DROP POLICY IF EXISTS "Utilizadores consultam os seus vouchers" ON public.vouchers;
CREATE POLICY "Utilizadores consultam os seus vouchers"
ON public.vouchers FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT private.is_admin())
);

GRANT SELECT ON public.referral_events, public.vouchers TO authenticated;

CREATE OR REPLACE FUNCTION public.process_checkout(
  p_checkout_id UUID,
  p_customer_name TEXT,
  p_items JSONB,
  p_payment_method TEXT,
  p_sale_date TIMESTAMPTZ,
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
  v_item RECORD;
  v_variant public.product_variants%ROWTYPE;
  v_existing_sale UUID;
  v_voucher public.vouchers%ROWTYPE;
  v_referrer_id UUID;
  v_referral_event_id UUID;
  v_reward_voucher_id UUID;
  v_old_count INTEGER;
  v_new_count INTEGER;
  v_rewards_to_create INTEGER;
  v_original_total NUMERIC(10,2);
  v_final_total NUMERIC(10,2);
  v_total_quantity INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND role IN ('admin', 'staff')
  ) THEN
    RAISE EXCEPTION 'Apenas a equipa pode confirmar vendas diretas.';
  END IF;
  IF p_checkout_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrinho inválido.';
  END IF;
  IF p_payment_method NOT IN ('Dinheiro', 'MB Way', 'Transferência', 'Stripe') THEN
    RAISE EXCEPTION 'Método de pagamento inválido.';
  END IF;

  SELECT id INTO v_existing_sale
  FROM public.sales
  WHERE checkout_id = p_checkout_id
  LIMIT 1;
  IF v_existing_sale IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'checkout_id', p_checkout_id, 'duplicate', true);
  END IF;

  SELECT COALESCE(SUM((item->>'quantity')::INTEGER), 0)
  INTO v_total_quantity
  FROM jsonb_array_elements(p_items) AS item;

  IF p_voucher_id IS NOT NULL THEN
    SELECT * INTO v_voucher
    FROM public.vouchers
    WHERE id = p_voucher_id
      AND user_id = v_user_id
      AND is_used = FALSE
      AND revoked_at IS NULL
      AND expires_at > NOW()
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Voucher inválido, expirado ou já utilizado.';
    END IF;
    IF jsonb_array_length(p_items) <> 1 OR v_total_quantity <> 1 THEN
      RAISE EXCEPTION 'O voucher de 15€ só pode ser aplicado a uma camisola por compra.';
    END IF;
  END IF;

  IF NULLIF(UPPER(TRIM(p_referral_code)), '') IS NOT NULL THEN
    SELECT id INTO v_referrer_id
    FROM public.profiles
    WHERE UPPER(referral_code) = UPPER(TRIM(p_referral_code));
    IF v_referrer_id IS NULL THEN
      RAISE EXCEPTION 'Código de amigo não encontrado.';
    END IF;
    IF v_referrer_id = v_user_id THEN
      RAISE EXCEPTION 'Não podes utilizar o teu próprio código.';
    END IF;
  END IF;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS x(
      local_id UUID,
      product_variant_id UUID,
      quantity INTEGER,
      unit_price NUMERIC
    )
    ORDER BY product_variant_id
  LOOP
    IF v_item.local_id IS NULL OR v_item.product_variant_id IS NULL
       OR v_item.quantity IS NULL OR v_item.quantity <= 0
       OR v_item.unit_price IS NULL OR v_item.unit_price < 0 THEN
      RAISE EXCEPTION 'Existe um artigo inválido no carrinho.';
    END IF;

    SELECT * INTO v_variant
    FROM public.product_variants
    WHERE id = v_item.product_variant_id AND is_active = TRUE
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Um dos artigos já não está disponível.';
    END IF;
    IF v_variant.stock_quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para o tamanho %. Disponível: %.',
        v_variant.size, v_variant.stock_quantity;
    END IF;

    v_original_total := ROUND(v_item.unit_price * v_item.quantity, 2);
    v_final_total := CASE WHEN p_voucher_id IS NOT NULL THEN 15.00 ELSE v_original_total END;

    UPDATE public.product_variants
    SET stock_quantity = stock_quantity - v_item.quantity
    WHERE id = v_item.product_variant_id;

    INSERT INTO public.sales (
      local_id, checkout_id, customer_name, product_variant_id, quantity,
      original_total_price, total_price, payment_method, sale_date,
      sync_status, created_by, voucher_id
    ) VALUES (
      v_item.local_id, p_checkout_id, NULLIF(TRIM(p_customer_name), ''),
      v_item.product_variant_id, v_item.quantity, v_original_total, v_final_total,
      p_payment_method, COALESCE(p_sale_date, NOW()), 'synced', v_user_id, p_voucher_id
    );
  END LOOP;

  IF p_voucher_id IS NOT NULL THEN
    UPDATE public.vouchers
    SET is_used = TRUE, used_at = NOW()
    WHERE id = p_voucher_id;
  END IF;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.referral_events(checkout_id, referrer_id, buyer_id, shirt_quantity)
    VALUES (p_checkout_id, v_referrer_id, v_user_id, v_total_quantity)
    RETURNING id INTO v_referral_event_id;

    SELECT referral_count INTO v_old_count
    FROM public.profiles
    WHERE id = v_referrer_id
    FOR UPDATE;

    UPDATE public.profiles
    SET referral_count = referral_count + v_total_quantity
    WHERE id = v_referrer_id
    RETURNING referral_count INTO v_new_count;

    UPDATE public.sales
    SET referral_event_id = v_referral_event_id
    WHERE checkout_id = p_checkout_id;

    v_rewards_to_create := FLOOR(v_new_count / 2.0) - FLOOR(v_old_count / 2.0);
    FOR v_item IN SELECT generate_series(1, v_rewards_to_create)
    LOOP
      INSERT INTO public.vouchers(
        user_id, code, expires_at, discount_type, referral_event_id
      ) VALUES (
        v_referrer_id,
        'V15-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 10)),
        NOW() + INTERVAL '90 days',
        'FIXED_PRICE_15',
        v_referral_event_id
      )
      RETURNING id INTO v_reward_voucher_id;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'checkout_id', p_checkout_id,
    'referral_count', v_new_count,
    'voucher_created', v_reward_voucher_id IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_voucher_notified(p_voucher_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.vouchers
  SET notified_at = COALESCE(notified_at, NOW())
  WHERE id = p_voucher_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.cancel_checkout(p_checkout_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale RECORD;
  v_event public.referral_events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'Apenas administradores podem cancelar vendas.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales
    WHERE checkout_id = p_checkout_id AND cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Venda não encontrada ou já cancelada.';
  END IF;

  SELECT re.* INTO v_event
  FROM public.referral_events re
  WHERE re.checkout_id = p_checkout_id AND re.status = 'confirmed'
  FOR UPDATE;

  IF FOUND THEN
    PERFORM 1
    FROM public.vouchers
    WHERE referral_event_id = v_event.id AND is_used = FALSE
    FOR UPDATE;
  END IF;

  FOR v_sale IN
    SELECT product_variant_id, quantity
    FROM public.sales
    WHERE checkout_id = p_checkout_id AND cancelled_at IS NULL
    ORDER BY product_variant_id
    FOR UPDATE
  LOOP
    UPDATE public.product_variants
    SET stock_quantity = stock_quantity + v_sale.quantity
    WHERE id = v_sale.product_variant_id;
  END LOOP;

  IF v_event.id IS NOT NULL THEN
    UPDATE public.referral_events
    SET status = 'reversed', reversed_at = NOW()
    WHERE id = v_event.id;

    UPDATE public.profiles
    SET referral_count = GREATEST(referral_count - v_event.shirt_quantity, 0)
    WHERE id = v_event.referrer_id;

    UPDATE public.vouchers
    SET revoked_at = NOW()
    WHERE referral_event_id = v_event.id AND is_used = FALSE;
  END IF;

  UPDATE public.sales SET cancelled_at = NOW() WHERE checkout_id = p_checkout_id;
  RETURN jsonb_build_object('success', true, 'checkout_id', p_checkout_id);
END;
$$;

REVOKE ALL ON FUNCTION public.process_checkout(UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_voucher_notified(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_checkout(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_checkout(UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_voucher_notified(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_checkout(UUID) TO authenticated;

CREATE OR REPLACE VIEW public.monthly_sales_summary WITH (security_invoker = true) AS
SELECT
  DATE_TRUNC('month', sale_date AT TIME ZONE 'Europe/Lisbon') AS month,
  COUNT(*) AS total_sales,
  SUM(total_price) AS total_revenue
FROM public.sales
WHERE sync_status = 'synced' AND cancelled_at IS NULL
GROUP BY 1
ORDER BY 1 DESC;
