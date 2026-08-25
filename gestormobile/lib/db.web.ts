import type { OfflineSale, SyncStatus } from '@/types';

type StoredSale = OfflineSale & { created_at: string };

const DATABASE_NAME = 'gestormobile';
const STORE_NAME = 'offline_sales';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'local_id' });
        store.createIndex('sync_status', 'sync_status', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function useStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveOfflineSale(sale: OfflineSale): Promise<void> {
  await useStore('readwrite', (store) => store.put({ ...sale, created_at: new Date().toISOString() }));
}

async function getSalesByStatus(status: SyncStatus): Promise<StoredSale[]> {
  const rows = await useStore<StoredSale[]>('readonly', (store) =>
    store.index('sync_status').getAll(status),
  );
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function getPendingSales(): Promise<OfflineSale[]> {
  return getSalesByStatus('pending');
}

export async function getErrorSales(): Promise<OfflineSale[]> {
  return (await getSalesByStatus('error')).reverse();
}

export async function updateSaleStatus(localId: string, status: SyncStatus): Promise<void> {
  const sale = await useStore<StoredSale | undefined>('readonly', (store) => store.get(localId));
  if (sale) await useStore('readwrite', (store) => store.put({ ...sale, sync_status: status }));
}

export async function deleteSyncedSale(localId: string): Promise<void> {
  const sale = await useStore<StoredSale | undefined>('readonly', (store) => store.get(localId));
  if (sale?.sync_status === 'synced') {
    await useStore('readwrite', (store) => store.delete(localId));
  }
}

export function countPendingSales(): Promise<number> {
  return useStore<number>('readonly', (store) => store.index('sync_status').count('pending'));
}
