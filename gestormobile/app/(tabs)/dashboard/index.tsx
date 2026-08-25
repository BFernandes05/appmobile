import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { Colors } from "@/constants/colors";
import { ReferralRewards } from "@/components/ReferralRewards";
import { CustomerOrders } from "@/components/CustomerOrders";

interface DashboardData {
  todaySales: { total_price: number; quantity: number }[];
  pendingReservations: number;
  pendingOrders: number;
  monthly: { month: string; total_revenue: number }[];
  lowStock: {
    id: string;
    size: string;
    stock_quantity: number;
    product: { name: string } | null;
  }[];
}
interface ExportedSale {
  sale_date: string;
  total_price: number;
  quantity: number;
  payment_method: string;
  product_variants: { size: string; products: { name: string } | null } | null;
}

async function fetchDashboardData(): Promise<DashboardData> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [sales, reservations, orders, monthly, variants] = await Promise.all([
    supabase
      .from("sales")
      .select("total_price,quantity")
      .eq("sync_status", "synced")
      .is("cancelled_at", null)
      .gte("sale_date", today.toISOString()),
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("status", "Pendente"),
    supabase
      .from("customer_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("monthly_sales_summary").select("*").limit(6),
    supabase
      .from("product_variants")
      .select("id,size,stock_quantity,product:products(name)")
      .eq("is_active", true)
      .lte("stock_quantity", 4)
      .order("stock_quantity")
      .limit(6),
  ]);
  const failure = [sales, reservations, orders, monthly, variants].find(
    (result) => result.error,
  )?.error;
  if (failure) throw failure;
  return {
    todaySales: sales.data ?? [],
    pendingReservations: reservations.count ?? 0,
    pendingOrders: orders.count ?? 0,
    monthly: (monthly.data ?? []) as DashboardData["monthly"],
    lowStock: (variants.data ?? []) as unknown as DashboardData["lowStock"],
  };
}
function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export default function DashboardScreen() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = createStyles(c);
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const { isAdmin, isCustomer, profile, signOut } = useAuth();
  const { organization, settings } = useOrganization();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboardData,
    enabled: isAdmin,
  });
  const revenue =
    data?.todaySales.reduce((sum, s) => sum + Number(s.total_price), 0) ?? 0;
  const items = data?.todaySales.reduce((sum, s) => sum + s.quantity, 0) ?? 0;
  const chart = [...(data?.monthly ?? [])].reverse();
  const chartMax = Math.max(
    1,
    ...chart.map((item) => Number(item.total_revenue)),
  );
  const finishSignOut = async () => {
    try {
      await signOut();
    } catch {
      Alert.alert("Erro", "Não foi possível terminar a sessão.");
    }
  };
  const askSignOut = () => {
    if (Platform.OS === "web") {
      if (window.confirm("Queres terminar a sessão?")) void finishSignOut();
      return;
    }
    Alert.alert("Terminar sessão", "Queres terminar a sessão?", [
      { text: "Voltar", style: "cancel" },
      {
        text: "Terminar",
        style: "destructive",
        onPress: () => void finishSignOut(),
      },
    ]);
  };
  const exportCSV = async () => {
    try {
      const { data: rows, error: exportError } = await supabase
        .from("sales")
        .select(
          "sale_date,total_price,quantity,payment_method,product_variants(size,products(name))",
        )
        .is("cancelled_at", null)
        .order("sale_date", { ascending: false });
      if (exportError) throw exportError;
      let csv = "Data,Hora,Produto,Tamanho,Qtd,Total,Metodo\n";
      for (const sale of (rows ?? []) as unknown as ExportedSale[]) {
        const d = new Date(sale.sale_date);
        csv +=
          [
            d.toLocaleDateString("pt-PT"),
            d.toLocaleTimeString("pt-PT"),
            sale.product_variants?.products?.name ?? "Desconhecido",
            sale.product_variants?.size ?? "-",
            sale.quantity,
            sale.total_price,
            sale.payment_method,
          ]
            .map(csvCell)
            .join(",") + "\n";
      }
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "vendas_export.csv";
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const uri = FileSystem.documentDirectory + "vendas_export.csv";
        await FileSystem.writeAsStringAsync(uri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      }
    } catch {
      Alert.alert("Erro", "Não foi possível exportar as vendas.");
    }
  };
  if (isCustomer)
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.page}>
          <Header
            brand={settings.brand_name}
            name={profile?.full_name}
            onSignOut={askSignOut}
            colors={c}
          />
          <ReferralRewards colors={c} />
        </ScrollView>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
      >
        <Header
          brand={settings.brand_name}
          name={profile?.full_name}
          onSignOut={askSignOut}
          colors={c}
        />
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>
              VISÃO GERAL · {organization?.plan?.toUpperCase() ?? "BUSINESS"}
            </Text>
            <Text style={styles.heroTitle}>O teu negócio, num só lugar.</Text>
            <Text style={styles.heroText}>
              Acompanha vendas, stock, clientes e pedidos sem perder tempo entre
              ecrãs.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.primaryAction}
            onPress={() => router.push("/(tabs)/vendas/nova")}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.primaryActionText}>Registar venda</Text>
          </TouchableOpacity>
        </View>
        {isLoading ? (
          <ActivityIndicator color={c.primary} />
        ) : error ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Não foi possível carregar alguns indicadores.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.kpiGrid}>
              <Kpi
                icon="wallet-outline"
                label="Faturado hoje"
                value={`${revenue.toFixed(2)} €`}
                note={`${items} ${settings.item_plural} vendidos`}
                tone={c.primary}
                colors={c}
              />
              <Kpi
                icon="bag-check-outline"
                label="Pedidos por validar"
                value={String(data?.pendingOrders ?? 0)}
                note="Aguardam confirmação"
                tone={c.warning}
                colors={c}
              />
              <Kpi
                icon="calendar-outline"
                label="Reservas pendentes"
                value={String(data?.pendingReservations ?? 0)}
                note="Stock temporariamente bloqueado"
                tone={c.success}
                colors={c}
              />
              <Kpi
                icon="alert-circle-outline"
                label="Stock baixo"
                value={String(data?.lowStock.length ?? 0)}
                note="Variantes com 4 ou menos"
                tone={c.danger}
                colors={c}
              />
            </View>
            <View style={[styles.mainGrid, compact && styles.mainGridCompact]}>
              <View style={styles.chartCard}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Faturação mensal</Text>
                    <Text style={styles.sectionSubtitle}>
                      Últimos seis meses
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.ghostButton}
                    onPress={exportCSV}
                  >
                    <Ionicons
                      name="download-outline"
                      size={17}
                      color={c.textSecondary}
                    />
                    <Text style={styles.ghostText}>CSV</Text>
                  </TouchableOpacity>
                </View>
                {chart.length === 0 ? (
                  <EmptyLine
                    text="Ainda não existem dados suficientes."
                    colors={c}
                  />
                ) : (
                  <View style={styles.chart}>
                    {chart.map((item) => (
                      <View key={item.month} style={styles.chartColumn}>
                        <Text style={styles.chartValue}>
                          {Number(item.total_revenue).toFixed(0)}€
                        </Text>
                        <View
                          style={[
                            styles.chartBar,
                            {
                              height: Math.max(
                                8,
                                (Number(item.total_revenue) / chartMax) * 145,
                              ),
                            },
                          ]}
                        />
                        <Text style={styles.chartLabel}>
                          {new Date(item.month).toLocaleDateString("pt-PT", {
                            month: "short",
                          })}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <View style={styles.sideCard}>
                <View>
                  <Text style={styles.sectionTitle}>Ações rápidas</Text>
                  <Text style={styles.sectionSubtitle}>
                    Continua o trabalho com um toque
                  </Text>
                </View>
                <QuickAction
                  icon="shirt-outline"
                  label={`Novo ${settings.item_singular}`}
                  onPress={() => router.push("/(tabs)/catalogo/novo")}
                  colors={c}
                />
                <QuickAction
                  icon="calendar-outline"
                  label="Criar reserva"
                  onPress={() => router.push("/(tabs)/reservas/nova")}
                  colors={c}
                />
                <QuickAction
                  icon="people-outline"
                  label="Ver clientes"
                  onPress={() => router.push("/clientes")}
                  colors={c}
                />
                <QuickAction
                  icon="settings-outline"
                  label="Configurar empresa"
                  onPress={() => router.push("/dashboard/empresa")}
                  colors={c}
                />
              </View>
            </View>
            <View style={[styles.mainGrid, compact && styles.mainGridCompact]}>
              <View style={styles.sideCard}>
                <View>
                  <Text style={styles.sectionTitle}>Atenção ao stock</Text>
                  <Text style={styles.sectionSubtitle}>
                    Prioridades para reposição
                  </Text>
                </View>
                {data?.lowStock.length === 0 ? (
                  <EmptyLine text="Todo o stock está saudável." colors={c} />
                ) : (
                  data?.lowStock.map((item) => (
                    <View key={item.id} style={styles.stockRow}>
                      <View style={styles.stockIcon}>
                        <Ionicons
                          name="cube-outline"
                          size={18}
                          color={c.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.stockName}>
                          {item.product?.name ?? "Artigo"}
                        </Text>
                        <Text style={styles.stockMeta}>
                          Variante {item.size}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.stockQty,
                          {
                            color:
                              item.stock_quantity === 0 ? c.danger : c.warning,
                          },
                        ]}
                      >
                        {item.stock_quantity} un.
                      </Text>
                    </View>
                  ))
                )}
              </View>
              <View style={styles.ordersPanel}>
                <CustomerOrders colors={c} team />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
function Header({
  brand,
  name,
  onSignOut,
  colors,
}: {
  brand: string;
  name?: string | null;
  onSignOut: () => void;
  colors: typeof Colors.light;
}) {
  const s = createStyles(colors);
  return (
    <View style={s.header}>
      <View>
        <Text style={s.brand}>{brand}</Text>
        <Text style={s.welcome}>
          Olá{name ? `, ${name.split(" ")[0]}` : ""}
        </Text>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Terminar sessão"
        style={s.profileButton}
        onPress={onSignOut}
      >
        <View style={s.profileAvatar}>
          <Ionicons name="person" size={17} color={colors.primary} />
        </View>
        <Ionicons
          name="log-out-outline"
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
    </View>
  );
}
function Kpi({
  icon,
  label,
  value,
  note,
  tone,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  note: string;
  tone: string;
  colors: typeof Colors.light;
}) {
  const s = createStyles(colors);
  return (
    <View style={s.kpiCard}>
      <View style={[s.kpiIcon, { backgroundColor: `${tone}18` }]}>
        <Ionicons name={icon} size={20} color={tone} />
      </View>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={s.kpiNote}>{note}</Text>
    </View>
  );
}
function QuickAction({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: typeof Colors.light;
}) {
  const s = createStyles(colors);
  return (
    <TouchableOpacity style={s.quickRow} onPress={onPress}>
      <View style={s.quickIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={s.quickText}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}
function EmptyLine({
  text,
  colors,
}: {
  text: string;
  colors: typeof Colors.light;
}) {
  const s = createStyles(colors);
  return (
    <View style={s.emptyLine}>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}
function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    page: {
      width: "100%",
      maxWidth: 1440,
      alignSelf: "center",
      padding: 24,
      paddingBottom: 110,
      gap: 20,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    brand: {
      fontFamily: "Inter_700Bold",
      fontSize: 12,
      color: c.primary,
      letterSpacing: 0.5,
    },
    welcome: {
      fontFamily: "Inter_700Bold",
      fontSize: 26,
      color: c.text,
      marginTop: 2,
    },
    profileButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 13,
      padding: 7,
    },
    profileAvatar: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: c.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    hero: {
      backgroundColor: c.primary,
      borderRadius: 22,
      padding: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 20,
    },
    heroCopy: { flex: 1 },
    heroEyebrow: {
      fontFamily: "Inter_700Bold",
      fontSize: 10,
      letterSpacing: 1.1,
      color: "#E0E7FF",
    },
    heroTitle: {
      fontFamily: "Inter_700Bold",
      fontSize: 27,
      color: "#fff",
      marginTop: 6,
    },
    heroText: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: "#E0E7FF",
      marginTop: 5,
    },
    primaryAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      backgroundColor: "rgba(255,255,255,.18)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,.28)",
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    primaryActionText: {
      fontFamily: "Inter_700Bold",
      fontSize: 13,
      color: "#fff",
    },
    kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    kpiCard: {
      flex: 1,
      minWidth: 210,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 17,
      padding: 17,
    },
    kpiIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    kpiLabel: {
      fontFamily: "Inter_500Medium",
      fontSize: 12,
      color: c.textSecondary,
    },
    kpiValue: {
      fontFamily: "Inter_700Bold",
      fontSize: 25,
      color: c.text,
      marginTop: 6,
    },
    kpiNote: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: c.textTertiary,
      marginTop: 4,
    },
    mainGrid: { flexDirection: "row", alignItems: "stretch", gap: 14 },
    mainGridCompact: { flexDirection: "column" },
    chartCard: {
      flex: 1.55,
      minHeight: 280,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 18,
      padding: 19,
    },
    sideCard: {
      flex: 1,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 18,
      padding: 19,
      gap: 10,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: c.text },
    sectionSubtitle: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 3,
    },
    ghostButton: {
      flexDirection: "row",
      gap: 5,
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 9,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    ghostText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 11,
      color: c.textSecondary,
    },
    chart: {
      height: 205,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      marginTop: 18,
    },
    chartColumn: {
      flex: 1,
      height: "100%",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 6,
    },
    chartValue: {
      fontFamily: "Inter_500Medium",
      fontSize: 9,
      color: c.textTertiary,
    },
    chartBar: {
      width: "70%",
      maxWidth: 42,
      borderRadius: 8,
      backgroundColor: c.primary,
    },
    chartLabel: {
      fontFamily: "Inter_500Medium",
      fontSize: 10,
      color: c.textSecondary,
    },
    quickRow: {
      minHeight: 49,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    quickIcon: {
      width: 33,
      height: 33,
      borderRadius: 10,
      backgroundColor: c.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    quickText: {
      flex: 1,
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: c.text,
    },
    stockRow: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    stockIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: c.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    stockName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: c.text },
    stockMeta: {
      fontFamily: "Inter_400Regular",
      fontSize: 10,
      color: c.textSecondary,
      marginTop: 2,
    },
    stockQty: { fontFamily: "Inter_700Bold", fontSize: 13 },
    ordersPanel: { flex: 1.55 },
    emptyLine: {
      flex: 1,
      minHeight: 100,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyText: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: c.textSecondary,
    },
    notice: { backgroundColor: c.dangerLight, borderRadius: 12, padding: 14 },
    noticeText: { color: c.danger, fontFamily: "Inter_500Medium" },
  });
}
