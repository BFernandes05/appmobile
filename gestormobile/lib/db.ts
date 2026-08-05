// GestorMobile — Base de Dados Local (expo-sqlite) para modo offline
import * as SQLite from 'expo-sqlite';
import type { OfflineSale, SyncStatus } from '@/types';

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('gestormobile.db');
    await initDb(db);
  }
  return db;
}

async function initDb(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS offline_sales (
      local_id TEXT PRIMARY KEY,
      customer_name TEXT,
      product_variant_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      size TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total_price REAL NOT NULL,
      payment_method TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// Guardar venda offline
export async function saveOfflineSale(sale: OfflineSale): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT OR REPLACE INTO offline_sales
      (local_id, customer_name, product_variant_id, product_name, size,
       quantity, total_price, payment_method, sale_date, sync_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sale.local_id,
      sale.customer_name ?? null,
      sale.product_variant_id,
      sale.product_name,
      sale.size,
      sale.quantity,
      sale.total_price,
      sale.payment_method,
      sale.sale_date,
      sale.sync_status,
      sale.created_by ?? null,
    ]
  );
}

// Buscar vendas pendentes de sync
export async function getPendingSales(): Promise<OfflineSale[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<OfflineSale>(
    `SELECT * FROM offline_sales WHERE sync_status = 'pending' ORDER BY created_at ASC`
  );
  return rows;
}

// Buscar vendas com erro
export async function getErrorSales(): Promise<OfflineSale[]> {
  const database = await getDb();
  return database.getAllAsync<OfflineSale>(
    `SELECT * FROM offline_sales WHERE sync_status = 'error' ORDER BY created_at DESC`
  );
}

// Atualizar status de sync
export async function updateSaleStatus(localId: string, status: SyncStatus): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE offline_sales SET sync_status = ? WHERE local_id = ?`,
    [status, localId]
  );
}

// Apagar venda sincronizada (limpeza)
export async function deleteSyncedSale(localId: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `DELETE FROM offline_sales WHERE local_id = ? AND sync_status = 'synced'`,
    [localId]
  );
}

// Contar pendentes (para badge)
export async function countPendingSales(): Promise<number> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM offline_sales WHERE sync_status = 'pending'`
  );
  return result?.count ?? 0;
}
