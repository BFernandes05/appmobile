// GestorMobile — Ecrã de Vendas (POS + Histórico)
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, useColorScheme, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { syncPendingSales } from '@/lib/sync';
import { countPendingSales, getErrorSales } from '@/lib/db';
import { Colors } from '@/constants/colors';
import type { Sale } from '@/types';

async function fetchTodaySales(userId: string, isAdmin: boolean): Promise<Sale[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let query = supabase
    .from('sales')
    .select(`
      *,
      variant:product_variants(
        id, size, base_price,
        product:products(id, name)
      )
    `)
    .eq('sync_status', 'synced')
    .is('cancelled_at', null)
    .gte('sale_date', today.toISOString())
    .order('sale_date', { ascending: false });

  if (!isAdmin) {
    query = query.eq('created_by', userId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Sale[];
}

export default function VendasScreen() {
  const colorScheme = useColorScheme();
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const { data: sales = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['sales-today', user?.id, isAdmin],
    queryFn: () => fetchTodaySales(user!.id, isAdmin),
    enabled: !!user,
  });

  const refreshCounts = useCallback(async () => {
    setPendingCount(await countPendingSales());
    const errorSales = await getErrorSales();
    setErrorCount(errorSales.length);
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  // Sync automático ao recuperar rede
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      if (state.isConnected && user?.id) {
        const pending = await countPendingSales();
        if (pending > 0) {
          setSyncing(true);
          try {
            const result = await syncPendingSales(user.id);
            await refreshCounts();
            refetch();
            if (result.errors > 0) {
              Alert.alert(
                'Sync incompleto',
                `${result.synced} venda(s) sincronizada(s). ${result.errors} com erro — verifica as Pendências.`
              );
            }
          } finally {
            setSyncing(false);
          }
        }
      }
    });
    return () => unsubscribe();
  }, [user?.id, refetch, refreshCounts]);

  const totalHoje = sales.reduce((s, v) => s + v.total_price, 0);
  const styles = createStyles(c);

  const cancelCheckout = (checkoutId: string) => Alert.alert(
    'Cancelar venda',
    'O stock será reposto e o referral associado será descontado. Continuar?',
    [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Cancelar venda', style: 'destructive', onPress: async () => {
        const { data, error } = await supabase.rpc('cancel_checkout', { p_checkout_id: checkoutId });
        if (error || !data?.success) {
          Alert.alert('Erro', error?.message || 'Não foi possível cancelar a venda.');
          return;
        }
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: ['products'] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
          queryClient.invalidateQueries({ queryKey: ['rewards'] }),
        ]);
        Alert.alert('Venda cancelada', 'Stock e contagem de referrals foram corrigidos.');
      } },
    ],
  );

  const renderSale = ({ item }: { item: Sale }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.productName} numberOfLines={1}>
            {item.variant?.product?.name ?? '—'}
          </Text>
          <Text style={styles.saleDetails}>
            Tam. {item.variant?.size} · × {item.quantity}
            {item.customer_name ? ` · ${item.customer_name}` : ''}
          </Text>
        </View>
        <View style={styles.priceCol}>
          <Text style={styles.price}>{item.total_price.toFixed(2)} €</Text>
          <View style={[styles.paymentBadge, { backgroundColor: c.surfaceSecondary }]}>
            <Text style={styles.paymentText}>{item.payment_method}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.saleDate}>
        {new Date(item.sale_date).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
      </Text>
      {isAdmin && item.checkout_id && (
        <TouchableOpacity style={styles.cancelButton} onPress={() => cancelCheckout(item.checkout_id!)}>
          <Text style={styles.cancelButtonText}>Cancelar / Devolver</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Vendas</Text>
          <Text style={styles.headerSubtitle}>Hoje · {totalHoje.toFixed(2)} €</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/(tabs)/vendas/nova')}
          activeOpacity={0.8}
        >
          <Text style={styles.addButtonText}>+ Venda</Text>
        </TouchableOpacity>
      </View>

      {/* Banners de sync */}
      {syncing && (
        <View style={[styles.syncBanner, { backgroundColor: c.primaryLight }]}>
          <ActivityIndicator size="small" color={c.primary} />
          <Text style={[styles.syncBannerText, { color: c.primary }]}>A sincronizar vendas...</Text>
        </View>
      )}
      {!syncing && pendingCount > 0 && (
        <View style={[styles.syncBanner, { backgroundColor: c.warningLight }]}>
          <Text style={styles.syncBannerEmoji}>🔄</Text>
          <Text style={[styles.syncBannerText, { color: c.warning }]}>
            {pendingCount} venda(s) por sincronizar
          </Text>
        </View>
      )}
      {errorCount > 0 && (
        <TouchableOpacity
          style={[styles.syncBanner, { backgroundColor: c.dangerLight }]}
          onPress={() => Alert.alert('Pendências', `${errorCount} venda(s) com erro de stock. Verifica manualmente.`)}
        >
          <Text style={styles.syncBannerEmoji}>⚠️</Text>
          <Text style={[styles.syncBannerText, { color: c.danger }]}>
            {errorCount} erro(s) de sincronização — toca para ver
          </Text>
        </TouchableOpacity>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={sales}
          renderItem={renderSale}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); refreshCounts(); }} tintColor={c.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🛒</Text>
              <Text style={styles.emptyTitle}>Nenhuma venda hoje</Text>
              <Text style={styles.emptySubtitle}>Começa por registar a primeira venda do dia!</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
    },
    headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, color: c.text, letterSpacing: -0.5 },
    headerSubtitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: c.primary, marginTop: 2 },
    addButton: { backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
    addButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#fff' },
    syncBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 10,
      gap: 10,
      marginHorizontal: 20,
      marginBottom: 8,
      borderRadius: 10,
    },
    syncBannerEmoji: { fontSize: 16 },
    syncBannerText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
    list: { paddingHorizontal: 20, paddingBottom: 100 },
    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: c.border,
      gap: 8,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    productName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.text, maxWidth: 200 },
    saleDetails: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.textSecondary, marginTop: 3 },
    priceCol: { alignItems: 'flex-end', gap: 4 },
    price: { fontFamily: 'Inter_700Bold', fontSize: 18, color: c.primary },
    paymentBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    paymentText: { fontFamily: 'Inter_400Regular', fontSize: 11, color: c.textSecondary },
    saleDate: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.textTertiary },
    cancelButton: { alignSelf: 'flex-start', backgroundColor: c.dangerLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
    cancelButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: c.danger },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyState: { alignItems: 'center', paddingTop: 80, gap: 12 },
    emptyEmoji: { fontSize: 52 },
    emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: c.text },
    emptySubtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: c.textSecondary, textAlign: 'center' },
  });
}
