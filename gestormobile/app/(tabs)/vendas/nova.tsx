// GestorMobile — Registar Venda (POS)
import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, useColorScheme, KeyboardAvoidingView, Platform, Image,
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
import type { Product, ProductVariant, PaymentMethod, Voucher } from '@/types';

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
  const { user, isCustomer } = useAuth();
  const queryClient = useQueryClient();
  const cart = useCartStore();
  
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(null);
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');

  const { data: products = [] } = useQuery({
    queryKey: ['products-active-sales'],
    queryFn: fetchActiveProducts,
  });

  const { data: vouchers = [] } = useQuery({
    queryKey: ['available-vouchers', user?.id, isCustomer],
    queryFn: async (): Promise<Voucher[]> => {
      let query = supabase
        .from('vouchers')
        .select('*')
        .eq('is_used', false)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('expires_at');
      if (isCustomer) query = query.is('reserved_order_id', null);
      const { data, error } = await query;
      if (error) throw error;
      return data as Voucher[];
    },
    enabled: !!user?.id,
  });

  const styles = createStyles(c);
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );
  const selectedVoucher = vouchers.find(v => v.id === selectedVoucherId) ?? null;
  const voucherCanApply = cart.items.length === 1 && cart.itemCount() === 1;
  const checkoutTotal = selectedVoucher && voucherCanApply ? 15 : cart.total();

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
      const normalizedReferral = referralCode.trim().toUpperCase();

      if (isCustomer) {
        if (!isOnline) throw new Error('É necessária ligação à internet para enviar o pedido.');
        if (cart.paymentMethod === 'Dinheiro') throw new Error('Escolhe MB Way, Transferência ou Stripe.');
        if (!customerPhone.trim() || !deliveryAddress.trim()) throw new Error('Preenche o contacto e a morada de entrega.');
        if (selectedVoucherId && !voucherCanApply) {
          throw new Error('O voucher de 15 € só pode ser usado numa compra com uma camisola.');
        }
        const { data, error } = await supabase.rpc('create_customer_order', {
          p_items: cart.items.map((item) => ({
            product_variant_id: item.variant.id,
            quantity: item.quantity,
          })),
          p_payment_method: cart.paymentMethod,
          p_customer_phone: customerPhone.trim(),
          p_delivery_address: deliveryAddress.trim(),
          p_referral_code: normalizedReferral || null,
          p_voucher_id: selectedVoucherId,
        });
        if (error || !data?.success) throw new Error(error?.message || 'Não foi possível enviar o pedido.');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['customer-orders'] }),
          queryClient.invalidateQueries({ queryKey: ['products'] }),
          queryClient.invalidateQueries({ queryKey: ['available-vouchers'] }),
        ]);
        Alert.alert('Pedido enviado', 'A equipa vai validar o pagamento e confirmar a venda.', [{
          text: 'OK', onPress: () => { cart.clearCart(); setReferralCode(''); setSelectedVoucherId(null); setCustomerPhone(''); setDeliveryAddress(''); router.back(); },
        }]);
        return;
      }

      if (!isOnline && (normalizedReferral || selectedVoucherId)) {
        throw new Error('Código de amigo e vouchers exigem ligação à internet para validação segura.');
      }
      if (selectedVoucherId && !voucherCanApply) {
        throw new Error('O voucher de 15 € só pode ser usado numa compra com uma camisola.');
      }

      const checkoutId = Crypto.randomUUID();
      const offlineRows = cart.items.map((item) => ({
        local_id: Crypto.randomUUID(),
        customer_name: cart.customerName || null,
        product_variant_id: item.variant.id,
        product_name: item.variant.product.name,
        size: item.variant.size,
        quantity: item.quantity,
        total_price: selectedVoucherId ? 15 : item.unit_price * item.quantity,
        payment_method: cart.paymentMethod,
        sale_date: saleDate,
        sync_status: 'pending' as const,
        created_by: user?.id || null,
      }));

      for (const row of offlineRows) await saveOfflineSale(row);

      if (isOnline) {
        const { data, error } = await supabase.rpc('process_checkout', {
          p_checkout_id: checkoutId,
          p_customer_name: cart.customerName || null,
          p_items: cart.items.map((item, index) => ({
            local_id: offlineRows[index].local_id,
            product_variant_id: item.variant.id,
            quantity: item.quantity,
            unit_price: item.unit_price,
          })),
          p_payment_method: cart.paymentMethod,
          p_sale_date: saleDate,
          p_referral_code: normalizedReferral || null,
          p_voucher_id: selectedVoucherId,
        });

        const checkoutRpcUnavailable = error?.code === 'PGRST202'
          || error?.message?.includes('process_checkout');

        if (checkoutRpcUnavailable && !normalizedReferral && !selectedVoucherId) {
          // Compatibilidade durante o rollout: mantém vendas normais ativas
          // até a migração de referrals ser aplicada no Supabase.
          for (const row of offlineRows) {
            const legacy = await supabase.rpc('process_sale', {
              p_local_id: row.local_id,
              p_customer_name: row.customer_name,
              p_product_variant_id: row.product_variant_id,
              p_quantity: row.quantity,
              p_total_price: row.total_price,
              p_payment_method: row.payment_method,
              p_sale_date: row.sale_date,
              p_created_by: user?.id,
            });
            if (legacy.error || !legacy.data?.success) {
              await updateSaleStatus(row.local_id, 'error');
              throw new Error(legacy.error?.message || 'Não foi possível confirmar a venda.');
            }
          }
        } else if (error || !data?.success) {
          for (const row of offlineRows) await updateSaleStatus(row.local_id, 'error');
          throw new Error(error?.message || data?.error || 'Não foi possível confirmar a venda.');
        }
        for (const row of offlineRows) await updateSaleStatus(row.local_id, 'synced');
      }

      // Invalidar queries para atualizar UI
      queryClient.invalidateQueries({ queryKey: ['sales-today'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['available-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['rewards'] });
      
      Alert.alert(
        'Venda Registada!', 
        isOnline ? 'Venda sincronizada com sucesso.' : 'Guardada offline. Será sincronizada quando tiveres rede.',
        [{ text: 'OK', onPress: () => {
          cart.clearCart();
          setReferralCode('');
          setSelectedVoucherId(null);
          router.back();
        } }]
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
            <Text style={styles.label}>Escolher artigo</Text>
            <TextInput
              style={styles.input}
              value={productSearch}
              onChangeText={setProductSearch}
              placeholder="🔍 Nome da camisola..."
              placeholderTextColor={c.textTertiary}
            />
            <Text style={styles.catalogHint}>{filteredProducts.length} artigos disponíveis · toca para escolher</Text>
            <View style={styles.productGrid}>
            {filteredProducts.map((product) => {
              const activeVariants = (product.variants ?? []).filter((variant) => variant.is_active);
              const totalStock = activeVariants.reduce((sum, variant) => sum + variant.stock_quantity, 0);
              return (
              <TouchableOpacity
                key={product.id}
                accessibilityRole="button"
                accessibilityLabel={`Escolher ${product.name}, ${totalStock} em stock`}
                accessibilityState={{ selected: selectedProduct?.id === product.id, disabled: totalStock === 0 }}
                style={[styles.productCard, selectedProduct?.id === product.id && styles.productCardActive]}
                onPress={() => setSelectedProduct(product)}
                disabled={totalStock === 0}
              >
                {product.image_url ? (
                  <Image source={{ uri: product.image_url }} style={styles.productImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.productImage, styles.productPlaceholder]}><Text style={styles.productEmoji}>👕</Text></View>
                )}
                <View style={styles.productCardBody}>
                  <Text style={styles.productCardName} numberOfLines={2}>{product.name}</Text>
                  <Text style={styles.productCategory}>{product.category}</Text>
                  <Text style={[styles.productStock, totalStock === 0 && { color: c.danger }]}>
                    {totalStock > 0 ? `${totalStock} em stock` : 'Sem stock'}
                  </Text>
                </View>
              </TouchableOpacity>
            );})}
            </View>

            {filteredProducts.length === 0 && (
              <View style={styles.emptyProducts}><Text style={styles.emptyCartText}>Nenhum artigo corresponde à pesquisa.</Text></View>
            )}

            {selectedProduct && (
              <View style={styles.variantsBox}>
                <Text style={styles.variantsTitle}>Tamanhos para {selectedProduct.name}:</Text>
                <View style={styles.variantGrid}>
                  {(selectedProduct.variants ?? []).filter((variant) => variant.is_active).map((variant) => (
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
                    {!isCustomer && <View style={styles.priceEditContainer}>
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
                    </View>}
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
              <Text style={styles.totalValue}>{checkoutTotal.toFixed(2)} €</Text>
            </View>

            {selectedVoucher && voucherCanApply && (
              <Text style={styles.discountNote}>Voucher aplicado: esta camisola fica por 15,00 €.</Text>
            )}
            
            <View style={styles.paymentMethods}>
              {PAYMENT_METHODS.filter(method => !isCustomer || method !== 'Dinheiro').map(method => (
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
            
            {!isCustomer && <TextInput
               style={[styles.input, { marginBottom: 16 }]}
               placeholder="Nome do cliente (opcional)"
               placeholderTextColor={c.textTertiary}
               value={cart.customerName}
               onChangeText={cart.setCustomerName}
            />}

            {isCustomer && <>
              <TextInput style={[styles.input, { marginBottom: 12 }]} placeholder="Contacto telefónico"
                placeholderTextColor={c.textTertiary} value={customerPhone} onChangeText={setCustomerPhone}
                keyboardType="phone-pad" />
              <TextInput style={[styles.input, { marginBottom: 12 }]} placeholder="Morada completa de entrega"
                placeholderTextColor={c.textTertiary} value={deliveryAddress} onChangeText={setDeliveryAddress}
                multiline />
            </>}

            <TextInput
              style={[styles.input, { marginBottom: 12 }]}
              placeholder="Código de amigo (opcional)"
              placeholderTextColor={c.textTertiary}
              value={referralCode}
              onChangeText={(value) => setReferralCode(value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            {vouchers.length > 0 && (
              <View style={styles.voucherSection}>
                <Text style={styles.voucherTitle}>Voucher de 15 €</Text>
                <TouchableOpacity
                  style={[styles.voucherOption, !selectedVoucherId && styles.voucherOptionActive]}
                  onPress={() => setSelectedVoucherId(null)}
                >
                  <Text style={styles.voucherOptionText}>○ Não aplicar voucher</Text>
                </TouchableOpacity>
                {vouchers.map((voucher) => (
                  <TouchableOpacity
                    key={voucher.id}
                    style={[styles.voucherOption, selectedVoucherId === voucher.id && styles.voucherOptionActive]}
                    onPress={() => {
                      if (!voucherCanApply) {
                        Alert.alert('Voucher de 15 €', 'Mantém apenas uma camisola com quantidade 1 no carrinho.');
                        return;
                      }
                      setSelectedVoucherId(voucher.id);
                    }}
                  >
                    <Text style={styles.voucherOptionText}>
                      {selectedVoucherId === voucher.id ? '●' : '○'} {voucher.code}
                    </Text>
                    <Text style={styles.voucherExpiry}>
                      Expira em {new Date(voucher.expires_at).toLocaleDateString('pt-PT')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity 
              style={[styles.checkoutBtn, finishing && { opacity: 0.7 }]}
              onPress={handleCheckout}
              disabled={finishing}
            >
              <Text style={styles.checkoutBtnText}>
                {finishing ? (isCustomer ? 'A enviar...' : 'A registar...') : (isCustomer ? 'Enviar pedido' : 'Finalizar Venda')}
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
    catalogHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.textSecondary },
    productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    productCard: { width: '48%', minWidth: 145, flexGrow: 1, flexBasis: 145, overflow: 'hidden', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14 },
    productCardActive: { borderColor: c.primary, borderWidth: 2, backgroundColor: c.primaryLight },
    productImage: { width: '100%', height: 112, backgroundColor: c.surfaceSecondary },
    productPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    productEmoji: { fontSize: 36 },
    productCardBody: { padding: 10, gap: 3 },
    productCardName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18, color: c.text },
    productCategory: { fontFamily: 'Inter_400Regular', fontSize: 11, color: c.textSecondary },
    productStock: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: c.success, marginTop: 3 },
    emptyProducts: { padding: 20, alignItems: 'center', backgroundColor: c.surfaceSecondary, borderRadius: 12 },
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
    discountNote: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.success, marginTop: -8, marginBottom: 12 },
    voucherSection: { gap: 7, marginBottom: 14 },
    voucherTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: c.text },
    voucherOption: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 10, gap: 2 },
    voucherOptionActive: { borderColor: c.primary, backgroundColor: c.primaryLight },
    voucherOptionText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.text },
    voucherExpiry: { fontFamily: 'Inter_400Regular', fontSize: 11, color: c.textSecondary, marginLeft: 18 },
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
