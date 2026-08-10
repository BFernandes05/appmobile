import * as Notifications from 'expo-notifications';
import type { Voucher } from '@/types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function notifyVoucherAward(voucher: Voucher): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted
    ? current
    : await Notifications.requestPermissionsAsync();

  if (!permission.granted) return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Ganhaste um voucher de 15 € 🎉',
      body: `O voucher ${voucher.code} já está disponível no teu Dashboard.`,
      data: { url: '/(tabs)/dashboard', voucherId: voucher.id },
    },
    trigger: null,
  });
  return true;
}
