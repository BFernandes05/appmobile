import { Stack } from 'expo-router';

export default function CatalogoLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="novo" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
