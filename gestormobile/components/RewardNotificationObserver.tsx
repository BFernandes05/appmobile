import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { notifyVoucherAward } from '@/lib/rewardNotifications';
import type { Voucher } from '@/types';

export function RewardNotificationObserver() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const processing = useRef<string | null>(null);
  const { data: voucher } = useQuery({
    queryKey: ['pending-voucher-notification', user?.id],
    enabled: !!user?.id,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Voucher | null> => {
      const { data, error } = await supabase
        .from('vouchers')
        .select('*')
        .is('notified_at', null)
        .is('revoked_at', null)
        .order('created_at')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Voucher | null;
    },
  });

  useEffect(() => {
    if (!voucher || processing.current === voucher.id) return;
    processing.current = voucher.id;
    (async () => {
      const shown = await notifyVoucherAward(voucher);
      if (!shown) Alert.alert('Novo voucher de 15 € 🎉', `O voucher ${voucher.code} está disponível.`);
      await supabase.rpc('mark_voucher_notified', { p_voucher_id: voucher.id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pending-voucher-notification', user?.id] }),
        queryClient.invalidateQueries({ queryKey: ['rewards', user?.id] }),
      ]);
      processing.current = null;
    })().catch(() => { processing.current = null; });
  }, [queryClient, user?.id, voucher]);

  return null;
}
