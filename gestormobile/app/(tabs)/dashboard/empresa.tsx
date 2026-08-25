import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "@/constants/colors";
import { OrganizationAdminPanel } from "@/components/OrganizationAdminPanel";

export default function EmpresaScreen() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = createStyles(c);
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
            style={styles.back}
          >
            <Ionicons name="arrow-back" size={20} color={c.text} />
          </TouchableOpacity>
          <View>
            <Text style={styles.eyebrow}>ADMINISTRAÇÃO</Text>
            <Text style={styles.title}>Configuração da empresa</Text>
            <Text style={styles.subtitle}>
              Adapta a plataforma ao teu negócio sem alterar código.
            </Text>
          </View>
        </View>
        <OrganizationAdminPanel colors={c} />
      </ScrollView>
    </SafeAreaView>
  );
}
function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    page: {
      width: "100%",
      maxWidth: 1200,
      alignSelf: "center",
      padding: 24,
      paddingBottom: 100,
      gap: 20,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 14 },
    back: {
      width: 42,
      height: 42,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    eyebrow: {
      fontFamily: "Inter_700Bold",
      fontSize: 10,
      letterSpacing: 1,
      color: c.primary,
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 27,
      color: c.text,
      marginTop: 3,
    },
    subtitle: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: c.textSecondary,
      marginTop: 3,
    },
  });
}
