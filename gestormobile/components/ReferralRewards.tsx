import { Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { Colors } from '@/constants/colors';
import type { Profile, Voucher } from '@/types';

interface RewardsData { profile: Profile; vouchers: Voucher[] }

export function ReferralRewards({ colors }: { colors: typeof Colors.light }) {
  const { user } = useAuth();
  const { settings } = useOrganization();
  const styles = createStyles(colors);
  const { data, isLoading, error } = useQuery({
    queryKey: ['rewards', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<RewardsData> => {
      const [profileResult, voucherResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user!.id).single(),
        supabase.from('vouchers').select('*').order('created_at', { ascending: false }),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (voucherResult.error) throw voucherResult.error;
      return { profile: profileResult.data as Profile, vouchers: voucherResult.data as Voucher[] };
    },
  });

  if (isLoading) return <Text style={styles.muted}>A carregar recompensas…</Text>;
  if (error || !data) return (
    <View style={styles.card}>
      <Text style={styles.title}>Recompensas</Text>
      <Text style={styles.muted}>O sistema de recompensas ainda não foi ativado na base de dados.</Text>
    </View>
  );

  const progress = data.profile.referral_count % 2;
  const available = data.vouchers.filter(v => !v.is_used && !v.revoked_at && new Date(v.expires_at) > new Date());
  const history = data.vouchers.filter(v => v.is_used || !!v.revoked_at || new Date(v.expires_at) <= new Date());
  const shareCode = () => Share.share({
    message: `Usa o meu código ${data.profile.referral_code} na tua compra na ${settings.brand_name}. A cada 2 compras indicadas ganho um ${settings.item_singular} por 15 €! https://gestormobile.expo.app`,
    title: `Código de amigo ${settings.brand_name}`,
  });

  return <View style={styles.wrapper}>
    <View style={styles.heroCard}>
      <Text style={styles.eyebrow}>O TEU CÓDIGO DE AMIGO</Text>
      <Text selectable style={styles.code}>{data.profile.referral_code}</Text>
      <TouchableOpacity style={styles.shareButton} onPress={shareCode}>
        <Text style={styles.shareButtonText}>Partilhar código</Text>
      </TouchableOpacity>
      <View style={styles.progressHeader}>
        <Text style={styles.progressTitle}>Próximo voucher</Text>
        <Text style={styles.progressCount}>{progress}/2 {settings.item_plural}</Text>
      </View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 50}%` }]} /></View>
      <Text style={styles.progressHint}>{progress === 1 ? `Falta apenas um ${settings.item_singular} indicado.` : 'Partilha o teu código para começar.'}</Text>
    </View>

    <View style={styles.card}>
      <Text style={styles.title}>Vouchers disponíveis ({available.length})</Text>
      {available.length === 0 ? <Text style={styles.muted}>Ainda não tens vouchers disponíveis.</Text> : available.map(v =>
        <View key={v.id} style={styles.voucherRow}>
          <View><Text style={styles.voucherCode}>{v.code}</Text><Text style={styles.voucherMeta}>{settings.item_singular} por 15 € · até {new Date(v.expires_at).toLocaleDateString('pt-PT')}</Text></View>
          <Text style={styles.availableBadge}>Disponível</Text>
        </View>
      )}
    </View>

    {history.length > 0 && <View style={styles.card}>
      <Text style={styles.title}>Histórico de vouchers</Text>
      {history.map(v => <View key={v.id} style={styles.voucherRow}>
        <Text style={styles.voucherCode}>{v.code}</Text>
        <Text style={styles.usedBadge}>{v.revoked_at ? 'Cancelado' : v.is_used ? 'Utilizado' : 'Expirado'}</Text>
      </View>)}
    </View>}
  </View>;
}

function createStyles(c: typeof Colors.light) { return StyleSheet.create({
  wrapper: { gap: 16 }, heroCard: { backgroundColor: c.primary, borderRadius: 18, padding: 20 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2, color: '#E0E7FF' },
  code: { fontFamily: 'Inter_700Bold', fontSize: 27, letterSpacing: 1.5, color: '#FFF', marginTop: 6 },
  shareButton: { alignSelf: 'flex-start', backgroundColor: '#FFF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginTop: 14 },
  shareButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: c.primary },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, marginBottom: 8 },
  progressTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#FFF' }, progressCount: { fontFamily: 'Inter_700Bold', fontSize: 13, color: '#FFF' },
  progressTrack: { height: 9, borderRadius: 5, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.25)' }, progressFill: { height: '100%', borderRadius: 5, backgroundColor: '#FFF' },
  progressHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#E0E7FF', marginTop: 8 },
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 16, gap: 12 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: c.text }, muted: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, color: c.textSecondary },
  voucherRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  voucherCode: { fontFamily: 'Inter_700Bold', fontSize: 14, color: c.text }, voucherMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, color: c.textSecondary, marginTop: 3 },
  availableBadge: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: c.success }, usedBadge: { fontFamily: 'Inter_500Medium', fontSize: 11, color: c.textTertiary },
}); }
