import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import type { CustomerOrder } from '@/types';

async function fetchOrders(team: boolean): Promise<CustomerOrder[]> {
  let query = supabase.from('customer_orders').select(`
    *, customer:profiles!customer_orders_customer_id_fkey(full_name,email),
    items:customer_order_items(*,variant:product_variants(size,product:products(name)))
  `).order('created_at', { ascending: false });
  if (team) query = query.eq('status', 'pending');
  const { data, error } = await query;
  if (error) throw error;
  return data as CustomerOrder[];
}

export function CustomerOrders({ colors, team = false }: { colors: typeof Colors.light; team?: boolean }) {
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['customer-orders', team ? 'team' : 'mine'],
    queryFn: () => fetchOrders(team),
  });

  const runAction = async (order: CustomerOrder, action: 'confirm' | 'cancel') => {
    const rpc = action === 'confirm' ? 'confirm_customer_order' : 'cancel_customer_order';
    const { data, error } = await supabase.rpc(rpc, { p_order_id: order.id });
    if (error || !data?.success) {
      Alert.alert('Erro', error?.message || 'Não foi possível atualizar o pedido.');
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['sales-today'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['rewards'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
    Alert.alert(action === 'confirm' ? 'Venda confirmada' : 'Pedido cancelado',
      action === 'confirm' ? 'A venda e as camisolas referenciadas foram registadas.' : 'O stock e o voucher reservado foram libertados.');
  };

  const ask = (order: CustomerOrder, action: 'confirm' | 'cancel') => {
    const message = action === 'confirm'
      ? 'Confirmar pagamento e transformar este pedido em venda?'
      : 'Cancelar este pedido e repor o stock?';
    if (Platform.OS === 'web') {
      if (window.confirm(message)) void runAction(order, action);
      return;
    }
    Alert.alert(action === 'confirm' ? 'Confirmar venda' : 'Cancelar pedido', message, [
      { text: 'Voltar', style: 'cancel' },
      { text: action === 'confirm' ? 'Confirmar' : 'Cancelar pedido', style: action === 'confirm' ? 'default' : 'destructive', onPress: () => void runAction(order, action) },
    ]);
  };

  if (isLoading) return <ActivityIndicator color={colors.primary} style={{ margin: 20 }} />;

  return <View style={styles.wrapper}>
    <View style={styles.headingRow}>
      <View>
        <Text style={styles.title}>{team ? 'Pedidos por confirmar' : 'As minhas compras'}</Text>
        <Text style={styles.subtitle}>{team ? `${orders.length} aguardam validação` : 'Acompanha aqui cada pedido'}</Text>
      </View>
      {!team && <TouchableOpacity style={styles.buyButton} onPress={() => router.push('/(tabs)/vendas/nova')}>
        <Text style={styles.buyButtonText}>+ Comprar</Text>
      </TouchableOpacity>}
    </View>
    {orders.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>{team ? 'Sem pedidos pendentes.' : 'Ainda não fizeste pedidos.'}</Text></View> : orders.map(order => (
      <View key={order.id} style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.customer}>{team ? (order.customer?.full_name || order.customer?.email) : `Pedido #${order.id.slice(0, 8).toUpperCase()}`}</Text>
            <Text style={styles.meta}>{new Date(order.created_at).toLocaleString('pt-PT')} · {order.payment_method}</Text>
            {team && <Text style={styles.meta}>{order.customer_phone} · {order.delivery_address}</Text>}
          </View>
          <Text style={styles.total}>{Number(order.final_total).toFixed(2)} €</Text>
        </View>
        {(order.items ?? []).map(item => <Text key={item.id} style={styles.item}>
          {item.variant?.product?.name ?? 'Artigo'} · Tam. {item.variant?.size ?? '—'} × {item.quantity}
        </Text>)}
        <View style={[styles.status, { backgroundColor: order.status === 'confirmed' ? colors.successLight : order.status === 'cancelled' ? colors.dangerLight : colors.warningLight }]}>
          <Text style={{ color: order.status === 'confirmed' ? colors.success : order.status === 'cancelled' ? colors.danger : colors.warning, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>
            {order.status === 'confirmed' ? 'Venda confirmada' : order.status === 'cancelled' ? 'Cancelado' : 'A aguardar confirmação da equipa'}
          </Text>
        </View>
        {order.status === 'pending' && <View style={styles.actions}>
          {team && <TouchableOpacity style={[styles.action, { backgroundColor: colors.success }]} onPress={() => ask(order, 'confirm')}><Text style={styles.actionText}>Confirmar venda</Text></TouchableOpacity>}
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.dangerLight }]} onPress={() => ask(order, 'cancel')}><Text style={[styles.actionText, { color: colors.danger }]}>Cancelar</Text></TouchableOpacity>
        </View>}
      </View>
    ))}
  </View>;
}

function createStyles(c: typeof Colors.light) { return StyleSheet.create({
  wrapper: { gap: 12 }, headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 21, color: c.text }, subtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.textSecondary, marginTop: 3 },
  buyButton: { backgroundColor: c.primary, borderRadius: 10, paddingHorizontal: 15, paddingVertical: 10 }, buyButtonText: { color: '#fff', fontFamily: 'Inter_700Bold' },
  empty: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 22 }, emptyText: { color: c.textSecondary, textAlign: 'center' },
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, gap: 9 },
  cardTop: { flexDirection: 'row', gap: 12 }, customer: { fontFamily: 'Inter_700Bold', fontSize: 15, color: c.text }, meta: { fontFamily: 'Inter_400Regular', fontSize: 11, color: c.textSecondary, marginTop: 3 },
  total: { fontFamily: 'Inter_700Bold', fontSize: 18, color: c.primary }, item: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.textSecondary },
  status: { alignSelf: 'flex-start', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5 }, actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, borderRadius: 9, paddingVertical: 10, alignItems: 'center' }, actionText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 12 },
}); }
