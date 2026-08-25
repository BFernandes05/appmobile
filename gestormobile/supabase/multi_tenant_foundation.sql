-- GestorMobile SaaS — Fundação multi-tenant
-- Executar uma única vez no SQL Editor depois dos scripts existentes.
-- A migração é idempotente e preserva os dados atuais na organização inicial.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  plan TEXT NOT NULL DEFAULT 'business'
    CHECK (plan IN ('starter', 'business', 'pro')),
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.organization_settings (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_type TEXT NOT NULL DEFAULT 'retail',
  brand_name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#7C83FD',
  currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
  locale TEXT NOT NULL DEFAULT 'pt-PT',
  timezone TEXT NOT NULL DEFAULT 'Europe/Lisbon',
  item_singular TEXT NOT NULL DEFAULT 'artigo',
  item_plural TEXT NOT NULL DEFAULT 'artigos',
  reservations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  referrals_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  customer_store_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organization_customers (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_organization_id UUID
  REFERENCES public.organizations(id) ON DELETE SET NULL;

DO $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'rbrbluxuries' LIMIT 1;
  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations(name, slug, status, plan)
    VALUES ('RBR BLuxuries', 'rbrbluxuries', 'active', 'business')
    RETURNING id INTO v_org_id;
  END IF;

  INSERT INTO public.organization_settings(organization_id, brand_name, business_type)
  VALUES (v_org_id, 'RBR BLuxuries', 'sportswear')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.organization_members(organization_id, user_id, role)
  SELECT v_org_id, id,
    CASE WHEN role = 'admin' THEN 'owner' ELSE 'staff' END
  FROM public.profiles
  WHERE role IN ('admin', 'staff')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO public.organization_customers(organization_id, user_id)
  SELECT v_org_id, id FROM public.profiles WHERE role = 'customer'
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE public.profiles
  SET active_organization_id = v_org_id
  WHERE active_organization_id IS NULL;
END $$;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT active_organization_id
  FROM public.profiles
  WHERE id = (SELECT auth.uid())
$$;

CREATE OR REPLACE FUNCTION private.is_organization_member(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = (SELECT auth.uid())
      AND status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.organization_customers
    WHERE organization_id = p_organization_id
      AND user_id = (SELECT auth.uid())
  )
$$;

CREATE OR REPLACE FUNCTION private.is_organization_team(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = (SELECT auth.uid())
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION private.can_manage_organization(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = (SELECT auth.uid())
      AND role IN ('owner', 'admin')
      AND status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION private.current_organization_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_organization_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_organization_team(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_manage_organization(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_organization_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_organization_team(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_organization(UUID) TO authenticated;

DO $$
DECLARE
  v_table TEXT;
  v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'rbrbluxuries';
  FOREACH v_table IN ARRAY ARRAY[
    'products', 'product_variants', 'reservations', 'sales',
    'customer_orders', 'customer_order_items', 'referral_events', 'vouchers'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT', v_table);
      EXECUTE format('UPDATE public.%I SET organization_id = $1 WHERE organization_id IS NULL', v_table) USING v_org_id;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', v_table);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT private.current_organization_id()', v_table);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organization_id)', v_table || '_organization_id_idx', v_table);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS organization_members_user_idx
  ON public.organization_members(user_id, status);
CREATE INDEX IF NOT EXISTS organization_customers_user_idx
  ON public.organization_customers(user_id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_customers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations, public.organization_settings,
  public.organization_members, public.organization_customers FROM anon, authenticated;
GRANT SELECT ON public.organizations, public.organization_settings,
  public.organization_members, public.organization_customers TO authenticated;
GRANT UPDATE ON public.organizations, public.organization_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;

DROP POLICY IF EXISTS "Membros consultam a organização" ON public.organizations;
CREATE POLICY "Membros consultam a organização" ON public.organizations
FOR SELECT TO authenticated
USING ((SELECT private.is_organization_member(id)));

DROP POLICY IF EXISTS "Gestores atualizam a organização" ON public.organizations;
CREATE POLICY "Gestores atualizam a organização" ON public.organizations
FOR UPDATE TO authenticated
USING ((SELECT private.can_manage_organization(id)))
WITH CHECK ((SELECT private.can_manage_organization(id)));

DROP POLICY IF EXISTS "Membros consultam definições" ON public.organization_settings;
CREATE POLICY "Membros consultam definições" ON public.organization_settings
FOR SELECT TO authenticated
USING ((SELECT private.is_organization_member(organization_id)));

DROP POLICY IF EXISTS "Gestores atualizam definições" ON public.organization_settings;
CREATE POLICY "Gestores atualizam definições" ON public.organization_settings
FOR UPDATE TO authenticated
USING ((SELECT private.can_manage_organization(organization_id)))
WITH CHECK ((SELECT private.can_manage_organization(organization_id)));

DROP POLICY IF EXISTS "Membros consultam a equipa" ON public.organization_members;
CREATE POLICY "Membros consultam a equipa" ON public.organization_members
FOR SELECT TO authenticated
USING ((SELECT private.is_organization_team(organization_id)));

DROP POLICY IF EXISTS "Gestores adicionam membros" ON public.organization_members;
CREATE POLICY "Gestores adicionam membros" ON public.organization_members
FOR INSERT TO authenticated
WITH CHECK ((SELECT private.can_manage_organization(organization_id)));

DROP POLICY IF EXISTS "Gestores atualizam membros" ON public.organization_members;
CREATE POLICY "Gestores atualizam membros" ON public.organization_members
FOR UPDATE TO authenticated
USING ((SELECT private.can_manage_organization(organization_id)))
WITH CHECK ((SELECT private.can_manage_organization(organization_id)));

DROP POLICY IF EXISTS "Gestores removem membros" ON public.organization_members;
CREATE POLICY "Gestores removem membros" ON public.organization_members
FOR DELETE TO authenticated
USING ((SELECT private.can_manage_organization(organization_id)) AND user_id <> (SELECT auth.uid()));

DROP POLICY IF EXISTS "Cliente consulta a sua ligação" ON public.organization_customers;
CREATE POLICY "Cliente consulta a sua ligação" ON public.organization_customers
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT private.is_organization_team(organization_id)));

-- Barreira adicional para funções legadas SECURITY DEFINER: uma sessão nunca pode
-- escrever ou apagar dados fora da sua organização ativa.
CREATE OR REPLACE FUNCTION private.enforce_active_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active UUID;
  v_row_org UUID;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  v_active := private.current_organization_id();
  v_row_org := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF v_active IS NULL OR v_row_org IS DISTINCT FROM v_active THEN
    RAISE EXCEPTION 'Operação bloqueada: organização inválida.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_active_organization() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'products', 'product_variants', 'reservations', 'sales',
    'customer_orders', 'customer_order_items', 'referral_events', 'vouchers'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS enforce_active_organization ON public.%I', v_table);
      EXECUTE format(
        'CREATE TRIGGER enforce_active_organization BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.enforce_active_organization()',
        v_table
      );
    END IF;
  END LOOP;
END $$;

-- Substitui políticas globais por políticas explicitamente multi-tenant.
DO $$
DECLARE v_table TEXT; v_policy RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'products', 'product_variants', 'reservations', 'sales',
    'customer_orders', 'customer_order_items', 'referral_events', 'vouchers'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
      FOR v_policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=v_table LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
      END LOOP;
    END IF;
  END LOOP;
END $$;

CREATE POLICY "Organização consulta produtos" ON public.products FOR SELECT TO authenticated
USING ((SELECT private.is_organization_member(organization_id)));
CREATE POLICY "Equipa cria produtos" ON public.products FOR INSERT TO authenticated
WITH CHECK ((SELECT private.can_manage_organization(organization_id)));
CREATE POLICY "Equipa atualiza produtos" ON public.products FOR UPDATE TO authenticated
USING ((SELECT private.can_manage_organization(organization_id)))
WITH CHECK ((SELECT private.can_manage_organization(organization_id)));

CREATE POLICY "Organização consulta variantes" ON public.product_variants FOR SELECT TO authenticated
USING ((SELECT private.is_organization_member(organization_id)));
CREATE POLICY "Equipa cria variantes" ON public.product_variants FOR INSERT TO authenticated
WITH CHECK ((SELECT private.can_manage_organization(organization_id)));
CREATE POLICY "Equipa atualiza variantes" ON public.product_variants FOR UPDATE TO authenticated
USING ((SELECT private.can_manage_organization(organization_id)))
WITH CHECK ((SELECT private.can_manage_organization(organization_id)));

CREATE POLICY "Equipa consulta reservas" ON public.reservations FOR SELECT TO authenticated
USING ((SELECT private.is_organization_team(organization_id)));
CREATE POLICY "Equipa cria reservas" ON public.reservations FOR INSERT TO authenticated
WITH CHECK ((SELECT private.is_organization_team(organization_id)));
CREATE POLICY "Equipa atualiza reservas" ON public.reservations FOR UPDATE TO authenticated
USING ((SELECT private.is_organization_team(organization_id)))
WITH CHECK ((SELECT private.is_organization_team(organization_id)));
CREATE POLICY "Equipa remove reservas" ON public.reservations FOR DELETE TO authenticated
USING ((SELECT private.is_organization_team(organization_id)));

CREATE POLICY "Equipa consulta vendas" ON public.sales FOR SELECT TO authenticated
USING ((SELECT private.is_organization_team(organization_id)));
CREATE POLICY "Equipa cria vendas" ON public.sales FOR INSERT TO authenticated
WITH CHECK ((SELECT private.is_organization_team(organization_id)));
CREATE POLICY "Gestores corrigem vendas" ON public.sales FOR UPDATE TO authenticated
USING ((SELECT private.can_manage_organization(organization_id)))
WITH CHECK ((SELECT private.can_manage_organization(organization_id)));
CREATE POLICY "Gestores removem vendas" ON public.sales FOR DELETE TO authenticated
USING ((SELECT private.can_manage_organization(organization_id)));

CREATE POLICY "Pedidos visíveis à organização" ON public.customer_orders FOR SELECT TO authenticated
USING (customer_id=(SELECT auth.uid()) OR (SELECT private.is_organization_team(organization_id)));
CREATE POLICY "Itens visíveis à organização" ON public.customer_order_items FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.customer_orders o WHERE o.id=order_id
  AND (o.customer_id=(SELECT auth.uid()) OR (SELECT private.is_organization_team(o.organization_id)))
));

CREATE POLICY "Referrals visíveis ao titular" ON public.referral_events FOR SELECT TO authenticated
USING (referrer_id=(SELECT auth.uid()) OR (SELECT private.is_organization_team(organization_id)));
CREATE POLICY "Vouchers visíveis ao titular" ON public.vouchers FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR (SELECT private.is_organization_team(organization_id)));

-- Os helpers antigos passam a avaliar o papel na organização ativa.
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT private.can_manage_organization(private.current_organization_id()) $$;
CREATE OR REPLACE FUNCTION private.is_team()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT private.is_organization_team(private.current_organization_id()) $$;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_team() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_team() TO authenticated;

-- Dashboard seguro: o filtro por organização é aplicado pela RLS da tabela sales.
DROP VIEW IF EXISTS public.monthly_sales_summary;
CREATE VIEW public.monthly_sales_summary WITH (security_invoker = true) AS
SELECT organization_id,
  DATE_TRUNC('month', sale_date AT TIME ZONE 'Europe/Lisbon') AS month,
  COUNT(*) AS total_sales,
  COALESCE(SUM(total_price), 0) AS total_revenue
FROM public.sales
WHERE sync_status='synced' AND cancelled_at IS NULL
GROUP BY organization_id, 2
ORDER BY 2 DESC;
GRANT SELECT ON public.monthly_sales_summary TO authenticated;

COMMIT;
