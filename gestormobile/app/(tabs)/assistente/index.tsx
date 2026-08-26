import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/hooks/useAuth";
import {
  executeAssistantAction,
  prepareAssistantIntent,
  type PreparedAssistantAction,
} from "@/lib/assistantEngine";
import { parseAssistantCommand } from "@/lib/assistantParser";

type ConversationItem = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

const SUGGESTIONS = [
  {
    icon: "alert-circle-outline" as const,
    label: "Stock baixo",
    prompt: "Mostra produtos com menos de 5 unidades",
  },
  {
    icon: "cash-outline" as const,
    label: "Vendas de hoje",
    prompt: "Mostra as vendas de hoje",
  },
  {
    icon: "people-outline" as const,
    label: "Top clientes",
    prompt: "Mostra os melhores clientes",
  },
  {
    icon: "add-circle-outline" as const,
    label: "Atualizar stock",
    prompt: "Adiciona 2 unidades ao Porto 26/27 tamanho M",
  },
];

const ROUTES: Record<string, string> = {
  catalogo: "/(tabs)/catalogo",
  reservas: "/(tabs)/reservas",
  vendas: "/(tabs)/vendas",
  clientes: "/(tabs)/clientes",
  dashboard: "/(tabs)/dashboard",
};

export default function AssistantScreen() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = createStyles(c);
  const { width } = useWindowDimensions();
  const desktop = width >= 960;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [pendingAction, setPendingAction] =
    useState<PreparedAssistantAction | null>(null);
  const [conversation, setConversation] = useState<ConversationItem[]>([
    {
      id: 1,
      role: "assistant",
      text: "Olá! Posso consultar vendas e stock, localizar artigos, abrir secções e preparar alterações. Só modifico dados depois da tua confirmação.",
    },
  ]);

  const addMessage = (role: ConversationItem["role"], text: string) => {
    setConversation((current) => [
      ...current,
      { id: Date.now() + Math.random(), role, text },
    ]);
    requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
  };

  const submit = async (prompt = input) => {
    const command = prompt.trim();
    if (!command || busy) return;
    setInput("");
    setPendingAction(null);
    addMessage("user", command);
    setBusy(true);
    try {
      const outcome = await prepareAssistantIntent(
        parseAssistantCommand(command),
      );
      addMessage("assistant", outcome.text);
      if (outcome.type === "confirmation") setPendingAction(outcome.action);
      if (outcome.type === "navigate") {
        const route = ROUTES[outcome.destination];
        if (route) setTimeout(() => router.push(route as never), 350);
      }
    } catch (error: any) {
      addMessage(
        "assistant",
        error?.message ?? "Não consegui concluir o pedido. Tenta novamente.",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async () => {
    if (!pendingAction || busy) return;
    setBusy(true);
    try {
      const message = await executeAssistantAction(pendingAction, user?.id);
      setPendingAction(null);
      addMessage("assistant", `✓ ${message}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["products-active"] }),
        queryClient.invalidateQueries({ queryKey: ["reservations"] }),
      ]);
    } catch (error: any) {
      addMessage(
        "assistant",
        error?.message ?? "Não foi possível executar esta ação.",
      );
      setPendingAction(null);
    } finally {
      setBusy(false);
    }
  };

  const startDictation = () => {
    if (Platform.OS !== "web") return;
    const browser = globalThis as any;
    const Recognition =
      browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) {
      addMessage(
        "assistant",
        "Este navegador não disponibiliza ditado. No iPhone podes usar o microfone do teclado para ditar a instrução.",
      );
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "pt-PT";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      addMessage(
        "assistant",
        "Não consegui ouvir. Confirma a permissão do microfone e tenta novamente.",
      );
    };
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      setInput(transcript);
    };
    recognition.start();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.logo}>
              <Ionicons name="sparkles" size={22} color="#fff" />
            </View>
            <View>
              <Text style={styles.eyebrow}>AUTOMAÇÃO SEM CUSTOS</Text>
              <Text style={styles.title}>Assistente</Text>
            </View>
          </View>
          <View style={styles.freeBadge}>
            <View style={styles.onlineDot} />
            <Text style={styles.freeText}>Gratuito</Text>
          </View>
        </View>

        <View style={styles.securityNote}>
          <Ionicons
            name="shield-checkmark-outline"
            size={18}
            color={c.success}
          />
          <Text style={styles.securityText}>
            Consulta os dados permitidos à tua conta. Ações com impacto exigem
            confirmação.
          </Text>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.conversation}
          contentContainerStyle={styles.conversationContent}
          keyboardShouldPersistTaps="handled"
        >
          {conversation.map((message) => (
            <View
              key={message.id}
              style={[
                styles.message,
                message.role === "user"
                  ? styles.userMessage
                  : styles.assistantMessage,
              ]}
            >
              {message.role === "assistant" && (
                <Ionicons
                  name="sparkles"
                  size={16}
                  color={c.primary}
                  style={styles.messageIcon}
                />
              )}
              <Text
                style={[
                  styles.messageText,
                  message.role === "user" && styles.userMessageText,
                ]}
              >
                {message.text}
              </Text>
            </View>
          ))}
          {busy && (
            <View style={[styles.message, styles.assistantMessage]}>
              <ActivityIndicator size="small" color={c.primary} />
              <Text style={styles.thinkingText}>A processar…</Text>
            </View>
          )}
          {pendingAction && (
            <View style={styles.confirmCard}>
              <View style={styles.confirmHeader}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={22}
                  color={c.warning}
                />
                <Text style={styles.confirmTitle}>{pendingAction.title}</Text>
              </View>
              <Text style={styles.confirmDescription}>
                {pendingAction.description}
              </Text>
              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    setPendingAction(null);
                    addMessage(
                      "assistant",
                      "Ação cancelada. Nenhum dado foi alterado.",
                    );
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={confirmAction}
                >
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <Text style={styles.confirmButtonText}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.suggestions}>
          <Text style={styles.suggestionsLabel}>EXPERIMENTA</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionRow}
          >
            {SUGGESTIONS.map((suggestion) => (
              <TouchableOpacity
                key={suggestion.label}
                style={styles.suggestionChip}
                onPress={() => submit(suggestion.prompt)}
                disabled={busy}
              >
                <Ionicons name={suggestion.icon} size={16} color={c.primary} />
                <Text style={styles.suggestionText}>{suggestion.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ex.: mostra produtos com menos de 5 unidades"
            placeholderTextColor={c.textTertiary}
            style={styles.input}
            multiline
            maxLength={300}
            onSubmitEditing={() => submit()}
            blurOnSubmit
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Ditar instrução"
            style={[styles.micButton, listening && styles.micButtonActive]}
            onPress={startDictation}
          >
            <Ionicons
              name={listening ? "radio" : "mic-outline"}
              size={21}
              color={listening ? "#fff" : c.primary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Enviar instrução"
            style={[
              styles.sendButton,
              (!input.trim() || busy) && styles.buttonDisabled,
            ]}
            onPress={() => submit()}
            disabled={!input.trim() || busy}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        {Platform.OS !== "web" && (
          <Text style={styles.voiceHint}>
            Para ditar no Expo Go, toca no campo e usa o microfone do teclado do
            iPhone.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    page: {
      flex: 1,
      width: "100%",
      alignSelf: "center",
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    pageDesktop: {
      maxWidth: 1040,
      paddingHorizontal: 32,
      paddingTop: 28,
      paddingBottom: 24,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    logo: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: c.primary,
      shadowOpacity: 0.28,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    eyebrow: {
      fontFamily: "Inter_700Bold",
      fontSize: 10,
      letterSpacing: 1.2,
      color: c.primary,
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 27,
      color: c.text,
      lineHeight: 32,
    },
    freeBadge: {
      flexDirection: "row",
      gap: 7,
      alignItems: "center",
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: c.successLight,
    },
    onlineDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: c.success,
    },
    freeText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 12,
      color: c.success,
    },
    securityNote: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 11,
      marginBottom: 12,
    },
    securityText: {
      flex: 1,
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      lineHeight: 17,
      color: c.textSecondary,
    },
    conversation: { flex: 1 },
    conversationContent: { paddingVertical: 6, gap: 10 },
    message: {
      maxWidth: "88%",
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 16,
    },
    assistantMessage: {
      alignSelf: "flex-start",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderBottomLeftRadius: 5,
    },
    userMessage: {
      alignSelf: "flex-end",
      backgroundColor: c.primary,
      borderBottomRightRadius: 5,
    },
    messageIcon: { marginTop: 2 },
    messageText: {
      flexShrink: 1,
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      lineHeight: 21,
      color: c.text,
    },
    userMessageText: { color: "#fff" },
    thinkingText: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: c.textSecondary,
    },
    confirmCard: {
      alignSelf: "flex-start",
      width: "92%",
      maxWidth: 520,
      borderWidth: 1,
      borderColor: c.warning,
      backgroundColor: c.warningLight,
      borderRadius: 16,
      padding: 15,
      gap: 10,
    },
    confirmHeader: { flexDirection: "row", gap: 8, alignItems: "center" },
    confirmTitle: {
      flex: 1,
      fontFamily: "Inter_700Bold",
      fontSize: 15,
      color: c.text,
    },
    confirmDescription: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      lineHeight: 21,
      color: c.text,
    },
    confirmButtons: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      marginTop: 2,
    },
    cancelButton: {
      paddingHorizontal: 15,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    cancelButtonText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: c.textSecondary,
    },
    confirmButton: {
      flexDirection: "row",
      gap: 5,
      alignItems: "center",
      paddingHorizontal: 15,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: c.primary,
    },
    confirmButtonText: {
      fontFamily: "Inter_700Bold",
      fontSize: 13,
      color: "#fff",
    },
    suggestions: { paddingTop: 8, paddingBottom: 8 },
    suggestionsLabel: {
      fontFamily: "Inter_700Bold",
      fontSize: 10,
      letterSpacing: 1.1,
      color: c.textTertiary,
      marginBottom: 7,
    },
    suggestionRow: { gap: 8, paddingRight: 12 },
    suggestionChip: {
      flexDirection: "row",
      gap: 6,
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    suggestionText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 12,
      color: c.text,
    },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 18,
      padding: 7,
      shadowColor: c.shadow,
      shadowOpacity: 1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    input: {
      flex: 1,
      minHeight: 42,
      maxHeight: 96,
      paddingHorizontal: 9,
      paddingVertical: 10,
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: c.text,
      outlineStyle: "none",
    } as any,
    micButton: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: c.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    micButtonActive: { backgroundColor: c.danger },
    sendButton: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: { opacity: 0.4 },
    voiceHint: {
      fontFamily: "Inter_400Regular",
      fontSize: 10,
      textAlign: "center",
      color: c.textTertiary,
      marginTop: 5,
    },
  });
}
