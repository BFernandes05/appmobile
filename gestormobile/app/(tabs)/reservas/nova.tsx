// GestorMobile — Nova Reserva
import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, ActivityIndicator, useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/colors';
import type { Product, ProductVariant } from '@/types';

async function fetchActiveProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*, variants:product_variants(*)')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data as Product[]).filter(p => (p.variants ?? []).some(v => v.is_active && v.stock_quantity > 0));
}

export default function NovaReservaScreen() {
  const colorScheme = useColorScheme();
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [totalPrice, setTotalPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const { data: products = [] } = useQuery({
    queryKey: ['products-active'],
    queryFn: fetchActiveProducts,
  });

  const styles = createStyles(c);
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const selectVariant = (variant: ProductVariant) => {
    setSelectedVariant(variant);
    const qty = parseInt(quantity, 10) || 1;
    setTotalPrice((variant.base_price * qty).toFixed(2));
  };

  const handleQuantityChange = (v: string) => {
    setQuantity(v);
    if (selectedVariant) {
      const qty = parseInt(v, 10) || 1;
      setTotalPrice((selectedVariant.base_price * qty).toFixed(2));
    }
  };

  const handleCreate = async () => {
    if (!customerName.trim()) {
      Alert.alert('Campo obrigatório', 'Introduz o nome do cliente.');
      return;
    }
    if (!selectedVariant) {
      Alert.alert('Campo obrigatório', 'Seleciona um produto e tamanho.');
      return;
    }
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Quantidade inválida', 'Introduz uma quantidade válida.');
      return;
    }
    if (qty > selectedVariant.stock_quantity) {
      Alert.alert('Stock insuficiente', `Disponível: ${selectedVariant.stock_quantity} unidade(s).`);
      return;
    }
    const price = parseFloat(totalPrice);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Preço inválido', 'Introduz um valor válido.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('reservations').insert({
        customer_name: customerName.trim(),
        customer_contact: customerContact.trim() || null,
        product_variant_id: selectedVariant.id,
        quantity: qty,
        total_price: price,
        created_by: user?.id,
      });
      if (error) {
        if (error.message.includes('Stock insuficiente')) {
          Alert.alert('Stock insuficiente', error.message.split('.')[1] ?? '');
        } else {
          throw error;
        }
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      Alert.alert('✅ Reserva criada!', `Reserva para ${customerName.trim()} criada com sucesso. Válida por 24h.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Não foi possível criar a reserva.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nova Reserva</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Cliente */}
        <View style={styles.field}>
          <Text style={styles.label}>Nome do Cliente *</Text>
          <TextInput
            style={styles.input}
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Nome do cliente"
            placeholderTextColor={c.textTertiary}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Contacto (opcional)</Text>
          <TextInput
            style={styles.input}
            value={customerContact}
            onChangeText={setCustomerContact}
            placeholder="+351 9XX XXX XXX"
            placeholderTextColor={c.textTertiary}
            keyboardType="phone-pad"
          />
        </View>

        {/* Produto */}
        <View style={styles.field}>
          <Text style={styles.label}>Produto *</Text>
          <TextInput
            style={styles.input}
            value={productSearch}
            onChangeText={setProductSearch}
            placeholder="🔍 Pesquisar produto..."
            placeholderTextColor={c.textTertiary}
          />
          {filteredProducts.slice(0, 5).map((product) => (
            <TouchableOpacity
              key={product.id}
              style={[styles.productOption, selectedProduct?.id === product.id && styles.productOptionActive]}
              onPress={() => {
                setSelectedProduct(product);
                setSelectedVariant(null);
                setProductSearch(product.name);
              }}
            >
              <Text style={[styles.productOptionText, selectedProduct?.id === product.id && styles.productOptionTextActive]}>
                {product.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tamanho */}
        {selectedProduct && (
          <View style={styles.field}>
            <Text style={styles.label}>Tamanho *</Text>
            <View style={styles.variantGrid}>
              {(selectedProduct.variants ?? [])
                .filter((v) => v.is_active && v.stock_quantity > 0)
                .map((variant) => (
                  <TouchableOpacity
                    key={variant.id}
                    style={[styles.variantChip, selectedVariant?.id === variant.id && styles.variantChipActive]}
                    onPress={() => selectVariant(variant)}
                  >
                    <Text style={[styles.variantChipSize, selectedVariant?.id === variant.id && styles.variantChipTextActive]}>
                      {variant.size}
                    </Text>
                    <Text style={[styles.variantChipStock, selectedVariant?.id === variant.id && styles.variantChipTextActive]}>
                      {variant.stock_quantity} un.
                    </Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
        )}

        {/* Quantidade */}
        <View style={styles.row}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Quantidade *</Text>
            <TextInput
              style={styles.input}
              value={quantity}
              onChangeText={handleQuantityChange}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor={c.textTertiary}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Valor (€) *</Text>
            <TextInput
              style={styles.input}
              value={totalPrice}
              onChangeText={setTotalPrice}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={c.textTertiary}
            />
          </View>
        </View>

        {/* Stock disponível */}
        {selectedVariant && (
          <View style={styles.stockInfo}>
            <Text style={styles.stockInfoText}>
              📦 Stock disponível: {selectedVariant.stock_quantity} un. — Preço base: {selectedVariant.base_price.toFixed(2)} €
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.createBtn, loading && { opacity: 0.6 }]}
          onPress={handleCreate}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>Criar Reserva (válida 24h)</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
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
    scroll: { padding: 20, paddingBottom: 100, gap: 20 },
    field: { gap: 8 },
    label: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.text },
    input: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 14,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.text,
    },
    row: { flexDirection: 'row', gap: 12 },
    productOption: {
      backgroundColor: c.surfaceSecondary,
      borderRadius: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: c.border,
      marginTop: 4,
    },
    productOptionActive: { backgroundColor: c.primaryLight, borderColor: c.primary },
    productOptionText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.text },
    productOptionTextActive: { color: c.primary, fontFamily: 'Inter_600SemiBold' },
    variantGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    variantChip: {
      borderWidth: 1.5,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      alignItems: 'center',
      minWidth: 70,
    },
    variantChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    variantChipSize: { fontFamily: 'Inter_700Bold', fontSize: 16, color: c.text },
    variantChipStock: { fontFamily: 'Inter_400Regular', fontSize: 11, color: c.textSecondary },
    variantChipTextActive: { color: '#fff' },
    stockInfo: {
      backgroundColor: c.primaryLight,
      borderRadius: 10,
      padding: 12,
    },
    stockInfoText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.primary },
    createBtn: {
      backgroundColor: c.primary,
      borderRadius: 14,
      paddingVertical: 18,
      alignItems: 'center',
      marginTop: 8,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    },
    createBtnText: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#fff' },
  });
}
