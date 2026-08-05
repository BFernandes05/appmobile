// GestorMobile — Zustand Store do Carrinho de Venda
import { create } from 'zustand';
import type { CartItem, ProductVariant, Product, PaymentMethod } from '@/types';

interface CartStore {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  customerName: string;

  addItem: (variant: ProductVariant & { product: Product }, quantity: number, unit_price: number) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  updateUnitPrice: (variantId: string, price: number) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setCustomerName: (name: string) => void;
  clearCart: () => void;

  total: () => number;
  itemCount: () => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  paymentMethod: 'Dinheiro',
  customerName: '',

  addItem: (variant, quantity, unit_price) => {
    set((state) => {
      const existing = state.items.find((i) => i.variant.id === variant.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.variant.id === variant.id
              ? { ...i, quantity: i.quantity + quantity }
              : i
          ),
        };
      }
      return { items: [...state.items, { variant, quantity, unit_price }] };
    });
  },

  removeItem: (variantId) => {
    set((state) => ({
      items: state.items.filter((i) => i.variant.id !== variantId),
    }));
  },

  updateQuantity: (variantId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(variantId);
      return;
    }
    set((state) => ({
      items: state.items.map((i) =>
        i.variant.id === variantId ? { ...i, quantity } : i
      ),
    }));
  },

  updateUnitPrice: (variantId, price) => {
    set((state) => ({
      items: state.items.map((i) =>
        i.variant.id === variantId ? { ...i, unit_price: price } : i
      ),
    }));
  },

  setPaymentMethod: (method) => set({ paymentMethod: method }),
  setCustomerName: (name) => set({ customerName: name }),

  clearCart: () =>
    set({ items: [], customerName: '', paymentMethod: 'Dinheiro' }),

  total: () =>
    get().items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),

  itemCount: () =>
    get().items.reduce((sum, i) => sum + i.quantity, 0),
}));
