// GestorMobile — Ecrã de Login
import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/colors';

export default function LoginScreen() {
  const colorScheme = useColorScheme();
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;

  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Por favor preenche o email e a password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch (e: any) {
      setError('Credenciais inválidas. Verifica o email e a password.');
    } finally {
      setLoading(false);
    }
  };

  const styles = createStyles(c);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo / Header */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoEmoji}>⚽</Text>
            </View>
            <Text style={styles.title}>GestorMobile</Text>
            <Text style={styles.subtitle}>Gestão de camisolas de futebol</Text>
          </View>

          {/* Formulário */}
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="o.teu@email.com"
                placeholderTextColor={c.textTertiary}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[styles.input, { paddingRight: 56 }]}
                  placeholder="••••••••"
                  placeholderTextColor={c.textTertiary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Entrar</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>
            Acesso restrito. Contacta o administrador para obter credenciais.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    scroll: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingVertical: 40,
    },
    header: {
      alignItems: 'center',
      marginBottom: 48,
    },
    logoContainer: {
      width: 88,
      height: 88,
      borderRadius: 22,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 12,
    },
    logoEmoji: {
      fontSize: 44,
    },
    title: {
      fontFamily: 'Inter_700Bold',
      fontSize: 32,
      color: c.text,
      marginBottom: 8,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      color: c.textSecondary,
    },
    form: {
      gap: 20,
    },
    inputGroup: {
      gap: 8,
    },
    label: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: c.text,
    },
    input: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 16,
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      color: c.text,
    },
    passwordContainer: {
      position: 'relative',
    },
    eyeButton: {
      position: 'absolute',
      right: 16,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
    },
    eyeIcon: {
      fontSize: 20,
    },
    errorBox: {
      backgroundColor: c.dangerLight,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: c.danger,
    },
    errorText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      color: c.danger,
    },
    button: {
      backgroundColor: c.primary,
      borderRadius: 14,
      paddingVertical: 18,
      alignItems: 'center',
      marginTop: 8,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      fontFamily: 'Inter_700Bold',
      fontSize: 17,
      color: '#ffffff',
      letterSpacing: 0.2,
    },
    footer: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: c.textTertiary,
      textAlign: 'center',
      marginTop: 40,
    },
  });
}
