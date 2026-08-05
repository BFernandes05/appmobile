// GestorMobile — Dashboard
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, useColorScheme, TouchableOpacity, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/colors';

interface ExportedSale {
  sale_date: string;
  total_price: number;
  quantity: number;
  payment_method: string;
  product_variants: {
    size: string;
    products: { name: string } | null;
  } | null;
}

function csvCell(value: string | number): string {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

// Helpers de dados
async function fetchDashboardData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [salesRes, reservationsRes, monthlyRes] = await Promise.all([
    supabase.from('sales').select('total_price, quantity').eq('sync_status', 'synced').gte('sale_date', today.toISOString()),
    supabase.from('reservations').select('id', { count: 'exact' }).eq('status', 'Pendente'),
    supabase.from('monthly_sales_summary').select('*').limit(6)
  ]);

  return {
    todaySales: salesRes.data || [],
    pendingReservations: reservationsRes.count || 0,
    monthly: monthlyRes.data || []
  };
}

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const { isAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
    enabled: isAdmin,
  });

  const styles = createStyles(c);

  const exportCSV = async () => {
    try {
      const { data: allSales, error } = await supabase
        .from('sales')
        .select(`id, sale_date, total_price, quantity, payment_method, sync_status, product_variants(size, products(name))`)
        .order('sale_date', { ascending: false });
        
      if (error) throw error;

      let csv = 'Data,Hora,Produto,Tamanho,Qtd,Total,Metodo\n';
      (allSales as unknown as ExportedSale[]).forEach(s => {
        const d = new Date(s.sale_date);
        const dateStr = d.toLocaleDateString('pt-PT');
        const timeStr = d.toLocaleTimeString('pt-PT');
        const prodName = s.product_variants?.products?.name || 'Desconhecido';
        const size = s.product_variants?.size || '-';
        csv += [dateStr, timeStr, prodName, size, s.quantity, s.total_price, s.payment_method]
          .map(csvCell)
          .join(',') + '\n';
      });

      const fileUri = FileSystem.documentDirectory + 'vendas_export.csv';
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('Erro', 'A partilha de ficheiros não está disponível neste dispositivo.');
      }
    } catch (e: any) {
      Alert.alert('Erro', 'Não foi possível exportar as vendas.');
    }
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <Text style={{ fontSize: 60, marginBottom: 20 }}>🔒</Text>
        <Text style={styles.headerTitle}>Acesso Restrito</Text>
        <Text style={{ color: c.textSecondary, marginTop: 10 }}>O Dashboard financeiro é apenas para administradores.</Text>
      </SafeAreaView>
    );
  }

  if (isLoading || !data) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  const todayRevenue = data.todaySales.reduce((acc, s) => acc + s.total_price, 0);
  const todayItems = data.todaySales.reduce((acc, s) => acc + s.quantity, 0);

  // Preparar dados para o gráfico
  const chartData = [...data.monthly].reverse().map(m => {
    const d = new Date(m.month);
    return {
      value: m.total_revenue,
      label: d.toLocaleDateString('pt-PT', { month: 'short' }),
      topLabelComponent: () => (
        <Text style={{ color: c.textTertiary, fontSize: 10, marginBottom: 4 }}>{m.total_revenue}€</Text>
      )
    };
  });
  const maxChartValue = Math.max(1, ...chartData.map((item) => Number(item.value)));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dashboard</Text>
        <TouchableOpacity style={styles.exportBtn} onPress={exportCSV}>
          <Text style={styles.exportBtnText}>📥 Exportar CSV</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        
        {/* KPIs */}
        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Faturado Hoje</Text>
            <Text style={styles.kpiValue}>{todayRevenue.toFixed(2)} €</Text>
            <Text style={styles.kpiSub}>{todayItems} artigos vendidos</Text>
          </View>
          
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Reservas Pendentes</Text>
            <Text style={[styles.kpiValue, { color: data.pendingReservations > 0 ? c.warning : c.text }]}>
              {data.pendingReservations}
            </Text>
            <Text style={styles.kpiSub}>A aguardar pagamento</Text>
          </View>
        </View>

        {/* Gráfico Mensal */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Faturação Mensal (Últimos 6 meses)</Text>
          {chartData.length > 0 ? (
            <View style={styles.chartBars}>
              {chartData.map((item) => (
                <View key={item.label} style={styles.chartColumn}>
                  <Text style={styles.chartValue}>{Number(item.value).toFixed(0)} €</Text>
                  <View
                    style={[
                      styles.chartBar,
                      { height: Math.max(8, (Number(item.value) / maxChartValue) * 130) },
                    ]}
                  />
                  <Text style={styles.chartLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.noChartData}>
              <Text style={{ color: c.textSecondary }}>Sem dados suficientes para o gráfico.</Text>
            </View>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    centered: { justifyContent: 'center', alignItems: 'center', padding: 40 },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
    },
    headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, color: c.text, letterSpacing: -0.5 },
    exportBtn: { backgroundColor: c.surfaceSecondary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
    exportBtnText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.text },
    scroll: { padding: 20, paddingBottom: 100, gap: 20 },
    kpiGrid: { flexDirection: 'row', gap: 12 },
    kpiCard: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 4,
      elevation: 2,
    },
    kpiLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.textSecondary, marginBottom: 8 },
    kpiValue: { fontFamily: 'Inter_700Bold', fontSize: 24, color: c.primary, marginBottom: 4 },
    kpiSub: { fontFamily: 'Inter_400Regular', fontSize: 11, color: c.textTertiary },
    chartCard: {
      backgroundColor: c.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 4,
      elevation: 2,
    },
    chartTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: c.text },
    chartBars: { height: 180, marginTop: 20, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
    chartColumn: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
    chartBar: { width: '70%', maxWidth: 38, borderRadius: 7, backgroundColor: c.primary },
    chartValue: { fontFamily: 'Inter_500Medium', fontSize: 10, color: c.textTertiary },
    chartLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: c.textSecondary },
    noChartData: { padding: 40, alignItems: 'center' }
  });
}
