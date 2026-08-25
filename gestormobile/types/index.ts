// GestorMobile — TypeScript Types
// Tipos que espelham as tabelas do Supabase

export type UserRole = 'admin' | 'staff' | 'customer';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  referral_code: string;
  referral_count: number;
  created_at: string;
}

export type VoucherDiscountType = 'FIXED_PRICE_15';

export interface Voucher {
  id: string;
  user_id: string;
  code: string;
  is_used: boolean;
  expires_at: string;
  discount_type: VoucherDiscountType;
  used_at: string | null;
  revoked_at: string | null;
  notified_at: string | null;
  reserved_order_id: string | null;
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
  checkout_id: string | null;
  original_total_price: number | null;
  voucher_id: string | null;
  cancelled_at: string | null;
  variant?: ProductVariant & { product?: Product };
}

export type CustomerOrderStatus = 'pending' | 'confirmed' | 'cancelled';

export interface CustomerOrderItem {
  id: string;
  order_id: string;
  product_variant_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  variant?: ProductVariant & { product?: Product };
}

export interface CustomerOrder {
  id: string;
  customer_id: string;
  status: CustomerOrderStatus;
  payment_method: Exclude<PaymentMethod, 'Dinheiro'>;
  customer_phone: string;
  delivery_address: string;
  referral_code: string | null;
  voucher_id: string | null;
  original_total: number;
  final_total: number;
  created_at: string;
  confirmed_at: string | null;
  customer?: Pick<Profile, 'full_name' | 'email'>;
  items?: CustomerOrderItem[];
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
