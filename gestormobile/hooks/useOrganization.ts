import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { Organization, OrganizationMember, OrganizationSettings } from '@/types';

const fallbackSettings: OrganizationSettings = {
  organization_id: '',
  business_type: 'retail',
  brand_name: 'GestorMobile',
  logo_url: null,
  primary_color: '#7C83FD',
  currency_code: 'EUR',
  locale: 'pt-PT',
  timezone: 'Europe/Lisbon',
  item_singular: 'artigo',
  item_plural: 'artigos',
  reservations_enabled: true,
  referrals_enabled: true,
  customer_store_enabled: true,
  updated_at: new Date(0).toISOString(),
};

export function useOrganization() {
  const { profile, user } = useAuth();
  const organizationId = profile?.active_organization_id ?? null;

  const query = useQuery({
    queryKey: ['active-organization', organizationId, user?.id],
    enabled: Boolean(organizationId && user?.id),
    queryFn: async () => {
      const [organizationResult, settingsResult, memberResult] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', organizationId!).single(),
        supabase.from('organization_settings').select('*').eq('organization_id', organizationId!).single(),
        supabase.from('organization_members').select('*')
          .eq('organization_id', organizationId!).eq('user_id', user!.id).maybeSingle(),
      ]);

      if (organizationResult.error) throw organizationResult.error;
      if (settingsResult.error) throw settingsResult.error;

      return {
        organization: organizationResult.data as Organization,
        settings: settingsResult.data as OrganizationSettings,
        membership: memberResult.data as OrganizationMember | null,
      };
    },
  });

  const settings = query.data?.settings ?? fallbackSettings;
  const role = query.data?.membership?.role ?? null;

  return useMemo(() => ({
    organizationId,
    organization: query.data?.organization ?? null,
    settings,
    membership: query.data?.membership ?? null,
    role,
    isOwner: role === 'owner',
    canManage: role === 'owner' || role === 'admin',
    loading: Boolean(organizationId) && query.isLoading,
    error: query.error,
    refresh: query.refetch,
  }), [organizationId, query.data, query.error, query.isLoading, query.refetch, role, settings]);
}
