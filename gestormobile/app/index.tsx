import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View, useColorScheme } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/colors';

export default function IndexScreen() {
  const colorScheme = useColorScheme();
  const colors = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return session
    ? <Redirect href="/(tabs)/catalogo" />
    : <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
