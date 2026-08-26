// GestorMobile — navegação principal
import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import {
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";

type TabIconName = keyof typeof Ionicons.glyphMap;

function TabIcon({
  activeIcon,
  icon,
  focused,
  color,
}: {
  activeIcon: TabIconName;
  icon: TabIconName;
  focused: boolean;
  color: string;
}) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
      <Ionicons name={focused ? activeIcon : icon} size={22} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  const colorScheme = useColorScheme();
  const c = colorScheme === "dark" ? Colors.dark : Colors.light;
  const { width } = useWindowDimensions();
  const desktop = width >= 960;
  const { isCustomer } = useAuth();
  const { settings } = useOrganization();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: desktop ? "left" : "bottom",
        tabBarLabelPosition: desktop ? "beside-icon" : "below-icon",
        tabBarStyle: {
          backgroundColor: c.tabBar,
          borderColor: c.tabBarBorder,
          borderTopWidth: desktop ? 0 : StyleSheet.hairlineWidth,
          borderRightWidth: desktop ? StyleSheet.hairlineWidth : 0,
          width: desktop ? 228 : undefined,
          height: desktop ? "100%" : 86,
          paddingTop: desktop ? 28 : 8,
          paddingBottom: desktop ? 20 : 8,
          paddingHorizontal: desktop ? 12 : 0,
        },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarLabelStyle: [styles.tabLabel, desktop && styles.tabLabelDesktop],
        tabBarItemStyle: [styles.tabItem, desktop && styles.tabItemDesktop],
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="catalogo"
        options={{
          title: "Catálogo",
          tabBarAccessibilityLabel: "Abrir Catálogo",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              icon="shirt-outline"
              activeIcon="shirt"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="reservas"
        options={{
          href: isCustomer || !settings.reservations_enabled ? null : undefined,
          title: "Reservas",
          tabBarAccessibilityLabel: "Abrir Reservas",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              icon="calendar-outline"
              activeIcon="calendar"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="vendas"
        options={{
          href:
            isCustomer && !settings.customer_store_enabled ? null : undefined,
          title: isCustomer ? "Comprar" : "Vendas",
          tabBarAccessibilityLabel: isCustomer
            ? "Comprar artigos"
            : "Abrir Vendas",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              icon="cart-outline"
              activeIcon="cart"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="clientes"
        options={{
          href: isCustomer || !desktop ? null : undefined,
          title: "Clientes",
          tabBarAccessibilityLabel: "Abrir Clientes",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              icon="people-outline"
              activeIcon="people"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="assistente"
        options={{
          href: isCustomer ? null : undefined,
          title: "Assistente",
          tabBarAccessibilityLabel: "Abrir Assistente",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              icon="sparkles-outline"
              activeIcon="sparkles"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: isCustomer ? "Conta" : "Dashboard",
          tabBarAccessibilityLabel: "Abrir Dashboard",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              icon="stats-chart-outline"
              activeIcon="stats-chart"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    paddingVertical: 2,
  },
  tabItemDesktop: { maxHeight: 58, borderRadius: 12, marginVertical: 3 },
  tabLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  tabLabelDesktop: {
    fontSize: 13,
    textAlign: "left",
    marginTop: 0,
    marginLeft: 4,
  },
  iconContainer: {
    width: 46,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainerActive: {
    backgroundColor: "rgba(129, 140, 248, 0.16)",
  },
});
