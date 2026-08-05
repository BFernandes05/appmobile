// GestorMobile — Registar Venda (POS)
import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, useColorScheme, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useCartStore } from '@/stores/cartStore';
import { saveOfflineSale, updateSaleStatus } from '@/lib/db';
import { Colors } from '@/constants/colors';
import type { Product, ProductVariant, PaymentMethod } from '@/types';

const PAYMENT_METHODS: PaymentMethod[] = ['Dinheiro', 'MB Way', 'Transferência'];

async function fetchActiveProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*, variants:product_variants(*)')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data as Product[]).filter(p => (p.variants ?? []).some(v => v.is_active));
}

export default function NovaVendaScreen() {
  const colorScheme = useColorScheme();
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const cart = useCartStore();
  
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [finishing, setFinishing] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['products-active-sales'],
    queryFn: fetchActiveProducts,
  });

  const styles = createStyles(c);
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const addVariantToCart = (variant: ProductVariant, product: Product) => {
    if (variant.stock_quantity <= 0) {
      Alert.alert('Sem stock', 'Esta variante não tem stock disponível.');
      return;
    }
    // Verificar se já não excedeu o stock no carrinho
    const inCart = cart.items.find(i => i.variant.id === variant.id);
    if (inCart && inCart.quantity >= variant.stock_quantity) {
      Alert.alert('Limite atingido', `Só existem ${variant.stock_quantity} un. em stock.`);
      return;
    }
    cart.addItem({ ...variant, product }, 1, variant.base_price);
    setSelectedProduct(null);
    setProductSearch('');
  };

  const handleCheckout = async () => {
    if (cart.items.length === 0) return;
    setFinishing(true);

    try {
      const netInfo = await NetInfo.fetch();
      const isOnline = netInfo.isConnected;
      const saleDate = new Date().toISOString();

      // Guardar cada item do carrinho como uma venda
      for (const item of cart.items) {
        const localId = Crypto.randomUUID();
        
        // 1. Guardar offline (sempre primeiro)
        await saveOfflineSale({
          local_id: localId,
          customer_name: cart.customerName || null,
          product_variant_id: item.variant.id,
          product_name: item.variant.product.name,
          size: item.variant.size,
          quantity: item.quantity,
          total_price: item.unit_price * item.quantity,
          payment_method: cart.paymentMethod,
          sale_date: saleDate,
          sync_status: 'pending',
          created_by: user?.id || null,
        });

        // 2. Tentar sync imediato se online
        if (isOnline) {
          const { data, error } = await supabase.rpc('process_sale', {
            p_local_id: localId,
            p_customer_name: cart.customerName || null,
            p_product_variant_id: item.variant.id,
            p_quantity: item.quantity,
            p_total_price: item.unit_price * item.quantity,
            p_payment_method: cart.paymentMethod,
            p_sale_date: saleDate,
            p_created_by: user?.id,
          });

          if (!error && data?.success) {
            await updateSaleStatus(localId, 'synced');
          } else {
            await updateSaleStatus(localId, 'error');
          }
        }
      }

      // Invalidar queries para atualizar UI
      queryClient.invalidateQueries({ queryKey: ['sales-today'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      
      Alert.alert(
        'Venda Registada!', 
        isOnline ? 'Venda sincronizada com sucesso.' : 'Guardada offline. Será sincronizada quando tiveres rede.',
        [{ text: 'OK', onPress: () => { cart.clearCart(); router.back(); } }]
      );
    } catch (e: any) {
      Alert.alert('Erro', e.message || 'Ocorreu um erro ao registar a venda.');
    } finally {
      setFinishing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Registar Venda</Text>
          <TouchableOpacity onPress={() => cart.clearCart()} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Limpar</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          
          {/* Adicionar Produtos */}
          <View style={styles.section}>
            <Text style={styles.label}>Procurar Produto</Text>
            <TextInput
              style={styles.input}
              value={productSearch}
              onChangeText={setProductSearch}
              placeholder="🔍 Nome da camisola..."
              placeholderTextColor={c.textTertiary}
            />
            {productSearch.length > 0 && filteredProducts.slice(0, 4).map((product) => (
              <TouchableOpacity
                key={product.id}
                style={styles.searchResult}
                onPress={() => setSelectedProduct(product)}
              >
                <Text style={styles.searchResultText}>{product.name}</Text>
              </TouchableOpacity>
            ))}

            {selectedProduct && (
              <View style={styles.variantsBox}>
                <Text style={styles.variantsTitle}>Tamanhos para {selectedProduct.name}:</Text>
                <View style={styles.variantGrid}>
                  {(selectedProduct.variants ?? []).map((variant) => (
                    <TouchableOpacity
                      key={variant.id}
                      style={[styles.variantChip, variant.stock_quantity === 0 && { opacity: 0.5 }]}
                      onPress={() => addVariantToCart(variant, selectedProduct)}
                      disabled={variant.stock_quantity === 0}
                    >
                      <Text style={styles.variantSize}>{variant.size}</Text>
                      <Text style={styles.variantPrice}>{variant.base_price.toFixed(2)}€</Text>
                      <Text style={styles.variantStock}>{variant.stock_quantity} un.</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* Carrinho */}
          <View style={[styles.section, { flex: 1 }]}>
            <Text style={styles.label}>Carrinho ({cart.itemCount()} itens)</Text>
            {cart.items.length === 0 ? (
              <View style={styles.emptyCart}>
                <Text style={styles.emptyCartText}>Carrinho vazio. Adiciona produtos acima.</Text>
              </View>
            ) : (
              cart.items.map((item) => (
                <View key={item.variant.id} style={styles.cartItem}>
                  <View style={styles.cartItemInfo}>
                    <Text style={styles.cartItemName} numberOfLines={1}>{item.variant.product.name}</Text>
                    <Text style={styles.cartItemDetails}>Tam: {item.variant.size} · Stock: {item.variant.stock_quantity}</Text>
                  </View>
                  
                  <View style={styles.cartItemActions}>
                    <View style={styles.qtyControls}>
                      <TouchableOpacity 
                        style={styles.qtyBtn} 
                        onPress={() => cart.updateQuantity(item.variant.id, item.quantity - 1)}
                      >
                        <Text style={styles.qtyBtnText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{item.quantity}</Text>
                      <TouchableOpacity 
                        style={styles.qtyBtn}
                        onPress={() => {
                          if (item.quantity < item.variant.stock_quantity) {
                            cart.updateQuantity(item.variant.id, item.quantity + 1);
                          } else {
                            Alert.alert('Stock', 'Não há mais stock.');
                          }
                        }}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.priceEditContainer}>
                       <TextInput
                          style={styles.priceInput}
                          value={item.unit_price.toString()}
                          onChangeText={(val) => {
                             const num = parseFloat(val);
                             if (!isNaN(num)) cart.updateUnitPrice(item.variant.id, num);
                          }}
                          keyboardType="decimal-pad"
                       />
                       <Text style={styles.euroSymbol}>€</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>

        </ScrollView>

        {/* Footer (Pagamento) */}
        {cart.items.length > 0 && (
          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Text style={styles.totalLabel}>Total a Pagar</Text>
              <Text style={styles.totalValue}>{cart.total().toFixed(2)} €</Text>
            </View>
            
            <View style={styles.paymentMethods}>
              {PAYMENT_METHODS.map(method => (
                <TouchableOpacity
                  key={method}
                  style={[styles.paymentBtn, cart.paymentMethod === method && styles.paymentBtnActive]}
                  onPress={() => cart.setPaymentMethod(method)}
                >
                  <Text style={[styles.paymentBtnText, cart.paymentMethod === method && styles.paymentBtnTextActive]}>
                    {method}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <TextInput
               style={[styles.input, { marginBottom: 16 }]}
               placeholder="Nome do cliente (opcional)"
               placeholderTextColor={c.textTertiary}
               value={cart.customerName}
               onChangeText={cart.setCustomerName}
            />

            <TouchableOpacity 
              style={[styles.checkoutBtn, finishing && { opacity: 0.7 }]}
              onPress={handleCheckout}
              disabled={finishing}
            >
              <Text style={styles.checkoutBtnText}>
                {finishing ? 'A registar...' : 'Finalizar Venda'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    backBtn: { padding: 8 },
    backIcon: { fontSize: 32, color: c.text, lineHeight: 34 },
    headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: c.text },
    clearBtn: { padding: 8 },
    clearBtnText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: c.danger },
    scroll: { padding: 20, paddingBottom: 40, gap: 24 },
    section: { gap: 10 },
    label: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: c.text },
    input: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.text,
    },
    searchResult: {
      backgroundColor: c.surfaceSecondary,
      padding: 12,
      borderRadius: 10,
      marginTop: 4,
    },
    searchResultText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: c.text },
    variantsBox: {
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: c.border,
      marginTop: 8,
    },
    variantsTitle: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.textSecondary, marginBottom: 8 },
    variantGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    variantChip: {
      backgroundColor: c.surfaceSecondary,
      borderRadius: 10,
      padding: 10,
      alignItems: 'center',
      minWidth: 70,
    },
    variantSize: { fontFamily: 'Inter_700Bold', fontSize: 15, color: c.text },
    variantPrice: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.textSecondary },
    variantStock: { fontFamily: 'Inter_500Medium', fontSize: 10, color: c.primary, marginTop: 4 },
    emptyCart: {
      padding: 24,
      alignItems: 'center',
      backgroundColor: c.surfaceSecondary,
      borderRadius: 12,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: c.border,
    },
    emptyCartText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.textTertiary },
    cartItem: {
      flexDirection: 'column',
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: c.border,
      gap: 12,
      marginBottom: 8,
    },
    cartItemInfo: { gap: 4 },
    cartItemName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.text },
    cartItemDetails: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.textSecondary },
    cartItemActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    qtyControls: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceSecondary, borderRadius: 8 },
    qtyBtn: { paddingHorizontal: 16, paddingVertical: 8 },
    qtyBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: c.text },
    qtyText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: c.text, minWidth: 20, textAlign: 'center' },
    priceEditContainer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    priceInput: {
      backgroundColor: c.surfaceSecondary,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      color: c.text,
      minWidth: 60,
      textAlign: 'right',
    },
    euroSymbol: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.textSecondary },
    footer: {
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      padding: 20,
      paddingBottom: Platform.OS === 'ios' ? 34 : 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 10,
    },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    totalLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: c.textSecondary },
    totalValue: { fontFamily: 'Inter_700Bold', fontSize: 28, color: c.primary },
    paymentMethods: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    paymentBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    paymentBtnActive: { backgroundColor: c.primaryLight, borderColor: c.primary },
    paymentBtnText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.textSecondary },
    paymentBtnTextActive: { color: c.primary, fontFamily: 'Inter_600SemiBold' },
    checkoutBtn: { backgroundColor: c.success, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
    checkoutBtnText: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#fff' },
  });
}
