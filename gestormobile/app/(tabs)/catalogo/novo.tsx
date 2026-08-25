// GestorMobile — Criar Novo Produto (Admin only)
import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, ActivityIndicator, useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { Colors } from '@/constants/colors';

const CATEGORY_SUGGESTIONS = ['Principal', 'Novidade', 'Premium', 'Promoção', 'Serviço', 'Outro'];
const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

interface VariantInput {
  size: string;
  base_price: string;
  stock_quantity: string;
}

export default function NovoProdutoScreen() {
  const colorScheme = useColorScheme();
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const { user } = useAuth();
  const { organizationId, settings } = useOrganization();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [variants, setVariants] = useState<VariantInput[]>([
    { size: 'M', base_price: '', stock_quantity: '0' },
  ]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const styles = createStyles(c);

  const addVariant = () => {
    setVariants([...variants, { size: '', base_price: '', stock_quantity: '0' }]);
  };

  const updateVariant = (index: number, field: keyof VariantInput, value: string) => {
    setVariants((prev) => prev.map((v, i) => i === index ? { ...v, [field]: value } : v));
  };

  const removeVariant = (index: number) => {
    if (variants.length === 1) return;
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'O nome é obrigatório.';
    if (!category) newErrors.category = 'A categoria é obrigatória.';
    variants.forEach((v, i) => {
      if (!v.size.trim()) newErrors[`size_${i}`] = 'Tamanho obrigatório.';
      const price = parseFloat(v.base_price);
      if (isNaN(price) || price <= 0) newErrors[`price_${i}`] = 'Preço inválido.';
      const qty = parseInt(v.stock_quantity, 10);
      if (isNaN(qty) || qty < 0) newErrors[`qty_${i}`] = 'Quantidade inválida.';
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const { data: product, error: productError } = await supabase
        .from('products')
        .insert({ name: name.trim(), category: category.trim(), ...(organizationId ? { organization_id: organizationId } : {}) })
        .select()
        .single();
      if (productError) throw productError;

      const variantInserts = variants.map((v) => ({
        product_id: product.id,
        ...(organizationId ? { organization_id: organizationId } : {}),
        size: v.size.trim().toUpperCase(),
        base_price: parseFloat(v.base_price),
        stock_quantity: parseInt(v.stock_quantity, 10),
      }));
      const { error: varError } = await supabase.from('product_variants').insert(variantInserts);
      if (varError) throw varError;

      queryClient.invalidateQueries({ queryKey: ['products'] });
      Alert.alert('✅ Artigo criado!', `"${name.trim()}" foi adicionado ao catálogo.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Não foi possível criar o artigo.');
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
        <Text style={styles.headerTitle}>Novo {settings.item_singular}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Nome */}
        <View style={styles.field}>
          <Text style={styles.label}>Nome *</Text>
          <TextInput
            style={[styles.input, errors.name && styles.inputError]}
            value={name}
            onChangeText={setName}
            placeholder={`Nome do ${settings.item_singular}`}
            placeholderTextColor={c.textTertiary}
          />
          {errors.name && <Text style={styles.errorText}>{errors.name}</Text>}
        </View>

        {/* Categoria */}
        <View style={styles.field}>
          <Text style={styles.label}>Categoria *</Text>
          <TextInput
            style={[styles.input, errors.category && styles.inputError]}
            value={category}
            onChangeText={setCategory}
            placeholder="Escreve uma categoria"
            placeholderTextColor={c.textTertiary}
          />
          <View style={styles.categoryGrid}>
            {CATEGORY_SUGGESTIONS.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
                onPress={() => setCategory(cat)}
              >
                <Text style={[styles.categoryChipText, category === cat && styles.categoryChipTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {errors.category && <Text style={styles.errorText}>{errors.category}</Text>}
        </View>

        {/* Variantes */}
        <View style={styles.field}>
          <View style={styles.variantsHeader}>
            <Text style={styles.label}>Tamanhos e Stock *</Text>
            <TouchableOpacity onPress={addVariant} style={styles.addVariantBtn}>
              <Text style={styles.addVariantText}>+ Tamanho</Text>
            </TouchableOpacity>
          </View>

          {variants.map((variant, index) => (
            <View key={index} style={styles.variantRow}>
              {/* Tamanho */}
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[styles.input, errors[`size_${index}`] && styles.inputError]}
                  value={variant.size}
                  onChangeText={(v) => updateVariant(index, 'size', v)}
                  placeholder="M"
                  placeholderTextColor={c.textTertiary}
                  autoCapitalize="characters"
                />
              </View>
              {/* Preço */}
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[styles.input, errors[`price_${index}`] && styles.inputError]}
                  value={variant.base_price}
                  onChangeText={(v) => updateVariant(index, 'base_price', v)}
                  placeholder="€ 0.00"
                  placeholderTextColor={c.textTertiary}
                  keyboardType="decimal-pad"
                />
              </View>
              {/* Stock */}
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[styles.input, errors[`qty_${index}`] && styles.inputError]}
                  value={variant.stock_quantity}
                  onChangeText={(v) => updateVariant(index, 'stock_quantity', v)}
                  placeholder="Qtd"
                  placeholderTextColor={c.textTertiary}
                  keyboardType="number-pad"
                />
              </View>
              {variants.length > 1 && (
                <TouchableOpacity onPress={() => removeVariant(index)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {/* Tamanhos comuns rápidos */}
          <View style={styles.quickSizes}>
            <Text style={styles.quickSizesLabel}>Tamanhos rápidos:</Text>
            <View style={styles.quickSizesRow}>
              {COMMON_SIZES.map((size) => (
                <TouchableOpacity
                  key={size}
                  style={styles.quickSizeBtn}
                  onPress={() => {
                    if (!variants.some((v) => v.size.toUpperCase() === size)) {
                      addVariant();
                      setVariants((prev) => {
                        const updated = [...prev];
                        updated[updated.length - 1] = { ...updated[updated.length - 1], size };
                        return updated;
                      });
                    }
                  }}
                >
                  <Text style={styles.quickSizeBtnText}>{size}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Botão criar */}
        <TouchableOpacity
          style={[styles.createBtn, loading && { opacity: 0.6 }]}
          onPress={handleCreate}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>Criar Artigo</Text>
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
    scroll: { padding: 20, paddingBottom: 100, gap: 24 },
    field: { gap: 10 },
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
    inputError: { borderColor: c.danger },
    errorText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.danger },
    categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    categoryChip: {
      borderWidth: 1.5,
      borderColor: c.border,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    categoryChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    categoryChipText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: c.textSecondary },
    categoryChipTextActive: { color: '#fff' },
    variantsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    addVariantBtn: { backgroundColor: c.primaryLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    addVariantText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: c.primary },
    variantRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    removeBtn: { padding: 8 },
    removeBtnText: { fontSize: 16, color: c.danger },
    quickSizes: { gap: 8, marginTop: 4 },
    quickSizesLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.textSecondary },
    quickSizesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    quickSizeBtn: {
      backgroundColor: c.surfaceSecondary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: c.border,
    },
    quickSizeBtnText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.textSecondary },
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
