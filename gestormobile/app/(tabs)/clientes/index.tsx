import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Colors } from "@/constants/colors";

interface CustomerSale {
  customer_name: string | null;
  total_price: number;
  quantity: number;
  sale_date: string;
}
interface CustomerSummary {
  name: string;
  revenue: number;
  items: number;
  orders: number;
  lastPurchase: string;
}

async function fetchCustomers(): Promise<CustomerSummary[]> {
  const { data, error } = await supabase
    .from("sales")
    .select("customer_name,total_price,quantity,sale_date")
    .eq("sync_status", "synced")
    .is("cancelled_at", null)
    .order("sale_date", { ascending: false });
  if (error) throw error;
  const grouped = new Map<string, CustomerSummary>();
  for (const sale of (data ?? []) as CustomerSale[]) {
    const name = sale.customer_name?.trim() || "Cliente não identificado";
    const current = grouped.get(name) ?? {
      name,
      revenue: 0,
      items: 0,
      orders: 0,
      lastPurchase: sale.sale_date,
    };
    current.revenue += Number(sale.total_price);
    current.items += sale.quantity;
    current.orders += 1;
    grouped.set(name, current);
  }
  return [...grouped.values()].sort((a, b) => b.revenue - a.revenue);
}

export default function ClientesScreen() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = createStyles(c);
  const [search, setSearch] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["customer-directory"],
    queryFn: fetchCustomers,
  });
  const filtered = useMemo(
    () =>
      data.filter((item) =>
        item.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [data, search],
  );
  const totalRevenue = data.reduce((sum, item) => sum + item.revenue, 0);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>RELAÇÕES COMERCIAIS</Text>
            <Text style={styles.title}>Clientes</Text>
            <Text style={styles.subtitle}>
              Conhece quem compra e identifica os clientes mais valiosos.
            </Text>
          </View>
        </View>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Clientes identificados</Text>
            <Text style={styles.summaryValue}>{data.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Valor acumulado</Text>
            <Text style={styles.summaryValue}>{totalRevenue.toFixed(2)} €</Text>
          </View>
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={19} color={c.textTertiary} />
          <TextInput
            style={styles.search}
            value={search}
            onChangeText={setSearch}
            placeholder="Pesquisar cliente…"
            placeholderTextColor={c.textTertiary}
          />
        </View>
        {isLoading ? (
          <ActivityIndicator color={c.primary} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={34} color={c.textTertiary} />
            <Text style={styles.emptyTitle}>
              Ainda não existem clientes identificados
            </Text>
            <Text style={styles.emptyText}>
              Os nomes introduzidos nas vendas aparecem automaticamente aqui.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((customer, index) => (
              <View key={customer.name} style={styles.customerCard}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {customer.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.customerCopy}>
                  <Text style={styles.customerName}>{customer.name}</Text>
                  <Text style={styles.customerMeta}>
                    Última compra:{" "}
                    {new Date(customer.lastPurchase).toLocaleDateString(
                      "pt-PT",
                    )}{" "}
                    · {customer.items} unidades
                  </Text>
                </View>
                <View style={styles.customerValue}>
                  <Text style={styles.revenue}>
                    {customer.revenue.toFixed(2)} €
                  </Text>
                  <Text style={styles.orders}>
                    {customer.orders} compra{customer.orders === 1 ? "" : "s"}
                  </Text>
                </View>
                {index < 3 && (
                  <View style={styles.vip}>
                    <Text style={styles.vipText}>TOP {index + 1}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    page: {
      padding: 24,
      paddingBottom: 110,
      gap: 20,
      maxWidth: 1280,
      width: "100%",
      alignSelf: "center",
    },
    header: { flexDirection: "row", justifyContent: "space-between" },
    eyebrow: {
      fontFamily: "Inter_700Bold",
      fontSize: 10,
      letterSpacing: 1.2,
      color: c.primary,
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 32,
      color: c.text,
      marginTop: 3,
    },
    subtitle: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: c.textSecondary,
      marginTop: 4,
    },
    summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    summaryCard: {
      flex: 1,
      minWidth: 220,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      padding: 18,
    },
    summaryLabel: {
      fontFamily: "Inter_500Medium",
      fontSize: 12,
      color: c.textSecondary,
    },
    summaryValue: {
      fontFamily: "Inter_700Bold",
      fontSize: 26,
      color: c.text,
      marginTop: 7,
    },
    searchBox: {
      height: 50,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 13,
      paddingHorizontal: 15,
    },
    search: {
      flex: 1,
      color: c.text,
      fontFamily: "Inter_400Regular",
      fontSize: 14,
    },
    list: { gap: 10 },
    customerCard: {
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 15,
      padding: 15,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primaryLight,
    },
    avatarText: { fontFamily: "Inter_700Bold", color: c.primary },
    customerCopy: { flex: 1 },
    customerName: { fontFamily: "Inter_700Bold", fontSize: 15, color: c.text },
    customerMeta: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 4,
    },
    customerValue: { alignItems: "flex-end" },
    revenue: { fontFamily: "Inter_700Bold", fontSize: 16, color: c.text },
    orders: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 3,
    },
    vip: {
      position: "absolute",
      right: 12,
      top: -7,
      backgroundColor: c.primary,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    vipText: { fontFamily: "Inter_700Bold", fontSize: 8, color: "#fff" },
    empty: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      padding: 36,
    },
    emptyTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: c.text,
      marginTop: 10,
    },
    emptyText: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: c.textSecondary,
      textAlign: "center",
      marginTop: 4,
    },
  });
}
