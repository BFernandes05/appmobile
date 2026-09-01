// GestorMobile — Detalhe / Editar Produto
import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, ActivityIndicator, Image, Platform, useColorScheme, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/colors';
import type { Product, ProductVariant } from '@/types';

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

async function imageUriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Não foi possível preparar a imagem selecionada.');
    return response.arrayBuffer();
  }

  return new File(uri).arrayBuffer();
}

async function fetchProduct(id: string): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .select('*, variants:product_variants(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Product;
}

export default function ProductDetailScreen() {
  const colorScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 820;
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin, profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProduct(id),
    enabled: !!id,
  });

  const [editingVariant, setEditingVariant] = useState<string | null>(null);
  const [stockAdjust, setStockAdjust] = useState('');
  const [updatingVariant, setUpdatingVariant] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const styles = createStyles(c);

  // Upload de imagem
  const handleImagePick = async () => {
    if (!isAdmin) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
    });
    if (result.canceled) return;

    setUploadingImage(true);
    try {
      const asset = result.assets[0];
      // Normalizar o formato e reduzir o tamanho antes do envio.
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
      );

      const filePath = `${profile?.active_organization_id ?? 'legacy'}/${id}/${Date.now()}.jpg`;
      const imageData = await imageUriToArrayBuffer(manipulated.uri);

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, imageData, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('products')
        .update({ image_url: urlData.publicUrl })
        .eq('id', id);
      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      Alert.alert('Imagem atualizada', 'A fotografia do artigo foi guardada com sucesso.');
    } catch (e: any) {
      Alert.alert('Erro no upload', e.message ?? 'Erro desconhecido. Tenta novamente.');
    } finally {
      setUploadingImage(false);
    }
  };

  // Ajustar stock de variante
  const handleStockAdjust = async (variant: ProductVariant) => {
    const delta = parseInt(stockAdjust, 10);
    if (isNaN(delta)) {
      Alert.alert('Valor inválido', 'Introduz um número inteiro.');
      return;
    }
    const newStock = variant.stock_quantity + delta;
    if (newStock < 0) {
      Alert.alert('Stock inválido', 'O stock não pode ficar negativo.');
      return;
    }
    setUpdatingVariant(variant.id);
    try {
      const { data: updatedVariant, error } = await supabase
        .from('product_variants')
        .update({ stock_quantity: newStock })
        .eq('id', variant.id)
        .select('id, stock_quantity')
        .single();

      if (error) throw error;

      queryClient.setQueryData<Product>(['product', id], (current) => {
        if (!current) return current;
        return {
          ...current,
          variants: (current.variants ?? []).map((item) =>
            item.id === updatedVariant.id
              ? { ...item, stock_quantity: updatedVariant.stock_quantity }
              : item
          ),
        };
      });

      setEditingVariant(null);
      setStockAdjust('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product', id] }),
      ]);
    } catch (error: any) {
      Alert.alert(
        'Não foi possível atualizar o stock',
        error?.message ?? 'Confirma a ligação e tenta novamente.'
      );
    } finally {
      setUpdatingVariant(null);
    }
  };

  // Desativar produto (soft delete)
  const handleDeactivate = () => {
    Alert.alert(
      'Desativar artigo',
      'Este artigo deixará de aparecer no catálogo, mas o histórico de vendas é mantido. Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desativar',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('products').update({ is_active: false }).eq('id', id);
            queryClient.invalidateQueries({ queryKey: ['products'] });
            router.back();
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  if (!product) return null;

  const activeVariants = (product.variants ?? [])
    .filter((v) => v.is_active)
    .sort((a, b) => {
      const aIndex = SIZE_ORDER.indexOf(a.size.trim().toUpperCase());
      const bIndex = SIZE_ORDER.indexOf(b.size.trim().toUpperCase());
      return (aIndex === -1 ? SIZE_ORDER.length : aIndex)
        - (bIndex === -1 ? SIZE_ORDER.length : bIndex);
    });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pageScroll}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          {isAdmin && (
            <TouchableOpacity onPress={handleDeactivate} style={styles.deactivateBtn}>
              <Text style={styles.deactivateText}>Desativar</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.productLayout, isWide && styles.productLayoutWide]}>
        {/* Imagem */}
        <TouchableOpacity
          style={[styles.imagePanel, isWide && styles.imagePanelWide]}
          onPress={handleImagePick}
          disabled={!isAdmin || uploadingImage}
          activeOpacity={0.8}
        >
          {product.image_url ? (
            <Image source={{ uri: product.image_url }} style={[styles.heroImage, isWide && styles.heroImageWide]} resizeMode="contain" />
          ) : (
            <View style={[styles.heroImage, isWide && styles.heroImageWide, styles.heroPlaceholder]}>
              <Text style={styles.heroPlaceholderEmoji}>👕</Text>
              {isAdmin && <Text style={styles.heroPlaceholderText}>Toca para adicionar imagem</Text>}
            </View>
          )}
          {uploadingImage && (
            <View style={styles.uploadOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.uploadText}>A carregar imagem...</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={[styles.content, isWide && styles.contentWide]}>
          <View style={styles.editHeading}>
            <View style={styles.editHeadingText}>
              <Text style={styles.editEyebrow}>{isAdmin ? 'EDITAR ARTIGO' : 'ARTIGO'}</Text>
              <Text style={styles.productName}>{product.name}</Text>
            </View>
          </View>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{product.category}</Text>
          </View>

          {/* Variantes / Stock */}
          <View style={styles.stockHeading}>
            <Text style={styles.sectionTitle}>Tamanhos e stock</Text>
            {isAdmin && <Text style={styles.stockHint}>Use “+ / − Stock” para adicionar ou corrigir unidades.</Text>}
          </View>
          {activeVariants.length === 0 ? (
            <Text style={styles.emptyVariants}>Sem tamanhos adicionados.</Text>
          ) : (
            activeVariants.map((variant) => (
              <View key={variant.id} style={styles.variantCard}>
                <View style={styles.variantInfo}>
                  <Text style={styles.variantSize}>{variant.size}</Text>
                  <Text style={styles.variantPrice}>{variant.base_price.toFixed(2)} €</Text>
                </View>

                <View style={styles.variantStock}>
                  {editingVariant === variant.id ? (
                    <View style={styles.stockEditRow}>
                      <TextInput
                        style={styles.stockInput}
                        value={stockAdjust}
                        onChangeText={setStockAdjust}
                        keyboardType="numbers-and-punctuation"
                        placeholder="+5 ou -2"
                        placeholderTextColor={c.textTertiary}
                        autoFocus
                      />
                      <TouchableOpacity
                        style={styles.stockConfirm}
                        onPress={() => handleStockAdjust(variant)}
                        disabled={updatingVariant === variant.id}
                      >
                        {updatingVariant === variant.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={styles.stockConfirmText}>✓</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => { setEditingVariant(null); setStockAdjust(''); }}
                      >
                        <Text style={styles.stockCancel}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <Text style={[
                        styles.stockQty,
                        { color: variant.stock_quantity === 0 ? c.danger : variant.stock_quantity < 5 ? c.warning : c.success }
                      ]}>
                        {variant.stock_quantity} un.
                      </Text>
                      {isAdmin && (
                        <TouchableOpacity
                          style={styles.editStockBtn}
                          onPress={() => setEditingVariant(variant.id)}
                        >
                          <Text style={styles.editStockText}>+ / − Stock</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    pageScroll: { flexGrow: 1 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      width: '100%',
      maxWidth: 1500,
      alignSelf: 'center',
    },
    backBtn: { padding: 8 },
    backIcon: { fontSize: 32, color: c.text, lineHeight: 34 },
    deactivateBtn: {
      backgroundColor: c.dangerLight,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    deactivateText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: c.danger },
    productLayout: { width: '100%', maxWidth: 1500, alignSelf: 'center' },
    productLayoutWide: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 24, paddingBottom: 32, gap: 24 },
    imagePanel: { position: 'relative', overflow: 'hidden', backgroundColor: c.surfaceSecondary },
    imagePanelWide: { flex: 1.55, minHeight: 600, borderRadius: 20, borderWidth: 1, borderColor: c.border },
    heroImage: { width: '100%', height: 320, backgroundColor: c.surfaceSecondary },
    heroImageWide: { height: '100%', minHeight: 600 },
    heroPlaceholder: {
      backgroundColor: c.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    heroPlaceholderEmoji: { fontSize: 60 },
    heroPlaceholderText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.textSecondary },
    uploadOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    uploadText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: '#fff' },
    content: { padding: 20, gap: 16 },
    contentWide: { flex: 0.85, alignSelf: 'stretch', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 20, padding: 28, shadowColor: c.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 18, elevation: 4 },
    editHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    editHeadingText: { flex: 1, gap: 4 },
    editEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1, color: c.primary },
    productName: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 34, color: c.text, letterSpacing: -0.5 },
    categoryBadge: {
      alignSelf: 'flex-start',
      backgroundColor: c.primaryLight,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    categoryText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.primary },
    sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17, color: c.text, marginTop: 8 },
    stockHeading: { gap: 4 },
    stockHint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: c.textSecondary },
    emptyVariants: { fontFamily: 'Inter_400Regular', fontSize: 15, color: c.textSecondary },
    variantCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 76,
    },
    variantInfo: { gap: 4 },
    variantSize: { fontFamily: 'Inter_700Bold', fontSize: 18, color: c.text },
    variantPrice: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.textSecondary },
    variantStock: { alignItems: 'flex-end', gap: 6 },
    stockQty: { fontFamily: 'Inter_700Bold', fontSize: 20 },
    editStockBtn: {
      backgroundColor: c.primaryLight,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    editStockText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: c.primary },
    stockEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stockInput: {
      backgroundColor: c.surfaceSecondary,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.text,
      width: 80,
      borderWidth: 1,
      borderColor: c.border,
    },
    stockConfirm: {
      backgroundColor: c.success,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    stockConfirmText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
    stockCancel: { fontSize: 18, color: c.danger, paddingHorizontal: 4 },
  });
}
