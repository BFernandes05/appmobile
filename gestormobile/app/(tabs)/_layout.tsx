// GestorMobile — navegação principal
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { Colors } from '@/constants/colors';

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
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.tabBar,
          borderTopColor: c.tabBarBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 86,
          paddingTop: 8,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="catalogo"
        options={{
          title: 'Catálogo',
          tabBarAccessibilityLabel: 'Abrir Catálogo',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon="shirt-outline" activeIcon="shirt" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reservas"
        options={{
          title: 'Reservas',
          tabBarAccessibilityLabel: 'Abrir Reservas',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon="calendar-outline" activeIcon="calendar" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="vendas"
        options={{
          title: 'Vendas',
          tabBarAccessibilityLabel: 'Abrir Vendas',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon="cart-outline" activeIcon="cart" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarAccessibilityLabel: 'Abrir Dashboard',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon="stats-chart-outline" activeIcon="stats-chart" focused={focused} color={color} />
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
  tabLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  iconContainer: {
    width: 46,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainerActive: {
    backgroundColor: 'rgba(129, 140, 248, 0.16)',
  },
});
