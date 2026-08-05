// GestorMobile — Serviço de Sincronização Offline → Supabase
import { supabase } from '@/lib/supabase';
import {
  getPendingSales,
  updateSaleStatus,
  deleteSyncedSale,
} from '@/lib/db';

interface SyncResult {
  synced: number;
  errors: number;
}

export async function syncPendingSales(userId: string): Promise<SyncResult> {
  const pending = await getPendingSales();
  let synced = 0;
  let errors = 0;

  for (const sale of pending) {
    try {
      const { data, error } = await supabase.rpc('process_sale', {
        p_local_id: sale.local_id,
        p_customer_name: sale.customer_name,
        p_product_variant_id: sale.product_variant_id,
        p_quantity: sale.quantity,
        p_total_price: sale.total_price,
        p_payment_method: sale.payment_method,
        p_sale_date: sale.sale_date,
        p_created_by: userId,
      });

      if (error || !data?.success) {
        await updateSaleStatus(sale.local_id, 'error');
        errors++;
      } else {
        await updateSaleStatus(sale.local_id, 'synced');
        // Limpar após 24h (em produção usar um job)
        setTimeout(() => deleteSyncedSale(sale.local_id), 24 * 60 * 60 * 1000);
        synced++;
      }
    } catch {
      await updateSaleStatus(sale.local_id, 'error');
      errors++;
    }
  }

  return { synced, errors };
}
