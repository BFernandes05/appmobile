-- Reservas configuráveis: validade entre 1 e 90 dias.
-- Mantém as reservas antigas e valida novas datas no servidor.

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_expiry_range_check;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_expiry_range_check
  CHECK (
    expires_at >= reservation_date + INTERVAL '1 day'
    AND expires_at <= reservation_date + INTERVAL '90 days'
  ) NOT VALID;

ALTER TABLE public.reservations
  VALIDATE CONSTRAINT reservations_expiry_range_check;
