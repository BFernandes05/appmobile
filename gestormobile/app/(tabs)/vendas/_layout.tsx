import { Stack } from 'expo-router';

export default function VendasLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="nova" />
    </Stack>
  );
}
