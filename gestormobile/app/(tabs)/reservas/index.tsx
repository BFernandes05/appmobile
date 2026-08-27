// GestorMobile — Lista de Reservas
import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  useColorScheme,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import type { Reservation } from '@/types';

const STATUS_TABS = ['Pendente', 'Confirmada', 'Cancelada'] as const;

async function fetchReservations(): Promise<Reservation[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select(
      `
      *,
      variant:product_variants(
        id, size, base_price,
        product:products(id, name, image_url)
      )
    `,
    )
    .order('reservation_date', { ascending: false });
  if (error) throw error;
  return data as Reservation[];
}

function hoursLeft(expiresAt: string): number {
  return Math.max(0, (new Date(expiresAt).getTime() - Date.now()) / 3600000);
}

function formatCountdown(hours: number): string {
  if (hours <= 0) return 'Expirada';
  if (hours < 1) return `${Math.round(hours * 60)} min restantes`;
  return `${Math.round(hours)}h restantes`;
}

export default function ReservasScreen() {
  const colorScheme = useColorScheme();
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const [activeTab, setActiveTab] =
    useState<(typeof STATUS_TABS)[number]>('Pendente');
  const [paymentReservation, setPaymentReservation] =
    useState<Reservation | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    data: reservations = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchReservations,
    refetchInterval: 60000, // refresh a cada minuto (countdown)
  });

  const filtered = reservations.filter((r) => r.status === activeTab);

  const convertToSale = async (
    reservation: Reservation,
    paymentMethod: string,
  ) => {
    setConvertingId(reservation.id);
    try {
      const { data, error } = await supabase.rpc(
        'convert_reservation_to_sale',
        {
          p_reservation_id: reservation.id,
          p_payment_method: paymentMethod,
        },
      );
      if (error || !data?.success) {
        throw new Error(error?.message ?? data?.error ?? 'Tenta novamente.');
      }
      setPaymentReservation(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reservations'] }),
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      Alert.alert(
        'Venda registada',
        'A reserva foi convertida em venda com sucesso.',
      );
    } catch (error: any) {
      Alert.alert(
        'Não foi possível converter',
        error?.message ?? 'Tenta novamente.',
      );
    } finally {
      setConvertingId(null);
    }
  };

  const choosePaymentMethod = (reservation: Reservation) => {
    setPaymentReservation(reservation);
  };

  const cancelReservation = async (reservation: Reservation) => {
    const { data, error } = await supabase.rpc('cancel_reservation', {
      p_reservation_id: reservation.id,
    });
    if (error || !data?.success) {
      Alert.alert(
        'Não foi possível cancelar',
        error?.message ?? data?.error ?? 'Tenta novamente.',
      );
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['reservations'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const styles = createStyles(c);

  const renderItem = ({ item }: { item: Reservation }) => {
    const hours = hoursLeft(item.expires_at);
    const product = item.variant?.product;
    const countdownColor =
      hours < 2 ? c.danger : hours < 8 ? c.warning : c.success;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.customerInfo}>
            <Text style={styles.customerName}>{item.customer_name}</Text>
            {item.customer_contact && (
              <Text style={styles.customerContact}>
                📞 {item.customer_contact}
              </Text>
            )}
          </View>
          <Text style={styles.price}>{item.total_price.toFixed(2)} €</Text>
        </View>

        <View style={styles.productRow}>
          <Text style={styles.productName} numberOfLines={1}>
            {product?.name ?? '—'}
          </Text>
          <View style={styles.sizeBadge}>
            <Text style={styles.sizeText}>{item.variant?.size}</Text>
          </View>
          <Text style={styles.qty}>× {item.quantity}</Text>
        </View>

        {item.status === 'Pendente' && (
          <View style={styles.countdownRow}>
            <View
              style={[styles.countdownDot, { backgroundColor: countdownColor }]}
            />
            <Text style={[styles.countdownText, { color: countdownColor }]}>
              {formatCountdown(hours)}
            </Text>
          </View>
        )}

        {item.status === 'Pendente' && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: c.successLight }]}
              onPress={() => choosePaymentMethod(item)}
              disabled={convertingId === item.id}
            >
              <Text style={[styles.actionBtnText, { color: c.success }]}>
                {convertingId === item.id
                  ? 'A converter…'
                  : '💳 Converter em Venda'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: c.dangerLight }]}
              onPress={() => cancelReservation(item)}
            >
              <Text style={[styles.actionBtnText, { color: c.danger }]}>
                ✕ Cancelar
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Reservas</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/(tabs)/reservas/nova')}
          activeOpacity={0.8}
        >
          <Text style={styles.addButtonText}>+ Nova</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs de status */}
      <View style={styles.tabs}>
        {STATUS_TABS.map((tab) => {
          const count = reservations.filter((r) => r.status === tab).length;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.tabTextActive,
                ]}
              >
                {tab}
              </Text>
              {count > 0 && (
                <View
                  style={[
                    styles.tabBadge,
                    activeTab === tab && styles.tabBadgeActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabBadgeText,
                      activeTab === tab && styles.tabBadgeTextActive,
                    ]}
                  >
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={c.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📋</Text>
              <Text style={styles.emptyTitle}>Tudo limpo por aqui!</Text>
              <Text style={styles.emptySubtitle}>
                Sem reservas {activeTab.toLowerCase()}s de momento.
              </Text>
            </View>
          }
        />
      )}

      <Modal
        visible={Boolean(paymentReservation)}
        transparent
        animationType="fade"
        onRequestClose={() => !convertingId && setPaymentReservation(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.paymentModal}>
            <Text style={styles.modalEyebrow}>CONVERTER EM VENDA</Text>
            <Text style={styles.modalTitle}>Método de pagamento</Text>
            <Text style={styles.modalDescription}>
              Como foi paga a reserva de {paymentReservation?.customer_name}?
            </Text>
            {['Dinheiro', 'MB Way', 'Transferência'].map((method) => (
              <TouchableOpacity
                key={method}
                style={styles.paymentOption}
                onPress={() =>
                  paymentReservation &&
                  convertToSale(paymentReservation, method)
                }
                disabled={Boolean(convertingId)}
              >
                <Text style={styles.paymentOptionText}>{method}</Text>
                {convertingId ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <Text style={styles.paymentArrow}>›</Text>
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setPaymentReservation(null)}
              disabled={Boolean(convertingId)}
            >
              <Text style={styles.modalCancelText}>Voltar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    headerTitle: {
      fontFamily: 'Inter_700Bold',
      fontSize: 28,
      color: c.text,
      letterSpacing: -0.5,
    },
    addButton: {
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    addButtonText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      color: '#fff',
    },
    tabs: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      marginBottom: 16,
      gap: 8,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      gap: 6,
    },
    tabActive: { backgroundColor: c.primary, borderColor: c.primary },
    tabText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: c.textSecondary,
    },
    tabTextActive: { color: '#fff' },
    tabBadge: {
      backgroundColor: c.surfaceSecondary,
      borderRadius: 10,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
    tabBadgeText: {
      fontFamily: 'Inter_700Bold',
      fontSize: 11,
      color: c.textSecondary,
    },
    tabBadgeTextActive: { color: '#fff' },
    list: { paddingHorizontal: 20, paddingBottom: 100 },
    card: {
      backgroundColor: c.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: c.border,
      gap: 12,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    customerInfo: { gap: 4, flex: 1 },
    customerName: { fontFamily: 'Inter_700Bold', fontSize: 17, color: c.text },
    customerContact: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: c.textSecondary,
    },
    price: { fontFamily: 'Inter_700Bold', fontSize: 20, color: c.primary },
    productRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    productName: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: c.textSecondary,
    },
    sizeBadge: {
      backgroundColor: c.primaryLight,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    sizeText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: c.primary },
    qty: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      color: c.textSecondary,
    },
    countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    countdownDot: { width: 8, height: 8, borderRadius: 4 },
    countdownText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
    actions: { flexDirection: 'row', gap: 10 },
    actionBtn: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
    },
    actionBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyState: { alignItems: 'center', paddingTop: 80, gap: 12 },
    emptyEmoji: { fontSize: 52 },
    emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: c.text },
    emptySubtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.textSecondary,
      textAlign: 'center',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(2, 6, 23, 0.72)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    paymentModal: {
      width: '100%',
      maxWidth: 430,
      backgroundColor: c.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      padding: 20,
      gap: 10,
    },
    modalEyebrow: {
      fontFamily: 'Inter_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: c.primary,
    },
    modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, color: c.text },
    modalDescription: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: c.textSecondary,
      marginBottom: 4,
    },
    paymentOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceSecondary,
      borderRadius: 12,
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    paymentOptionText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      color: c.text,
    },
    paymentArrow: {
      fontFamily: 'Inter_400Regular',
      fontSize: 26,
      lineHeight: 26,
      color: c.primary,
    },
    modalCancel: { alignItems: 'center', paddingVertical: 11, marginTop: 2 },
    modalCancelText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: c.textSecondary,
    },
  });
}
