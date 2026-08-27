-- Corrige a conversão após a introdução de organizações.
-- A venda herda a organização da reserva e a reserva fica no histórico.
CREATE OR REPLACE FUNCTION public.convert_reservation_to_sale(
  p_reservation_id UUID,
  p_payment_method VARCHAR
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_sale_id UUID;
  v_active_organization UUID;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT private.is_team()) THEN
    RAISE EXCEPTION 'Apenas a equipa pode confirmar reservas.';
  END IF;

  IF p_payment_method NOT IN ('Dinheiro', 'MB Way', 'Transferência', 'Stripe') THEN
    RETURN json_build_object('success', FALSE, 'error', 'Método de pagamento inválido.');
  END IF;

  v_active_organization := private.current_organization_id();

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'Reserva não encontrada.');
  END IF;

  IF v_reservation.organization_id IS DISTINCT FROM v_active_organization THEN
    RAISE EXCEPTION 'A reserva não pertence à organização ativa.';
  END IF;

  IF v_reservation.status <> 'Pendente' THEN
    RETURN json_build_object('success', FALSE, 'error', 'A reserva já foi tratada.');
  END IF;

  INSERT INTO public.sales (
    organization_id,
    local_id,
    customer_name,
    product_variant_id,
    quantity,
    total_price,
    payment_method,
    sale_date,
    sync_status,
    created_by
  ) VALUES (
    v_reservation.organization_id,
    gen_random_uuid(),
    v_reservation.customer_name,
    v_reservation.product_variant_id,
    v_reservation.quantity,
    v_reservation.total_price,
    p_payment_method,
    NOW(),
    'synced',
    (SELECT auth.uid())
  ) RETURNING id INTO v_sale_id;

  UPDATE public.reservations
  SET status = 'Confirmada'
  WHERE id = p_reservation_id;

  RETURN json_build_object('success', TRUE, 'sale_id', v_sale_id);
END;
$$;

REVOKE ALL ON FUNCTION public.convert_reservation_to_sale(UUID, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_reservation_to_sale(UUID, VARCHAR) TO authenticated;
