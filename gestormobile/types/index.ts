// GestorMobile — TypeScript Types
// Tipos que espelham as tabelas do Supabase

export type UserRole = 'admin' | 'staff';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  variants?: ProductVariant[];
}

export interface ProductVariant {
  id: string;
  product_id: string;
  size: string;
  base_price: number;
  stock_quantity: number;
  is_active: boolean;
  updated_at: string;
  product?: Product;
}

export type ReservationStatus = 'Pendente' | 'Confirmada' | 'Cancelada';

export interface Reservation {
  id: string;
  customer_name: string;
  customer_contact: string | null;
  product_variant_id: string;
  quantity: number;
  total_price: number;
  status: ReservationStatus;
  reservation_date: string;
  expires_at: string;
  created_by: string | null;
  variant?: ProductVariant & { product?: Product };
}

export type PaymentMethod = 'Dinheiro' | 'MB Way' | 'Transferência' | 'Stripe';
export type SyncStatus = 'pending' | 'synced' | 'error';

export interface Sale {
  id: string;
  customer_name: string | null;
  product_variant_id: string;
  quantity: number;
  total_price: number;
  payment_method: PaymentMethod;
  stripe_payment_intent_id: string | null;
  sale_date: string;
  sync_status: SyncStatus;
  local_id: string | null;
  created_by: string | null;
  variant?: ProductVariant & { product?: Product };
}

// Carrinho de venda (estado local Zustand)
export interface CartItem {
  variant: ProductVariant & { product: Product };
  quantity: number;
  unit_price: number;
}

// Venda offline (guardada em SQLite)
export interface OfflineSale {
  local_id: string;
  customer_name: string | null;
  product_variant_id: string;
  product_name: string;
  size: string;
  quantity: number;
  total_price: number;
  payment_method: PaymentMethod;
  sale_date: string;
  sync_status: SyncStatus;
  created_by: string | null;
}
