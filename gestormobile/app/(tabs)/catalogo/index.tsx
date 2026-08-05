// GestorMobile — Catálogo de Produtos (ecrã principal)
import { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, RefreshControl, Image, useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Colors } from '@/constants/colors';
import type { Product } from '@/types';

async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      variants:product_variants(*)
    `)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data as Product[];
}

function totalStock(product: Product): number {
  return (product.variants ?? []).reduce((s, v) => s + (v.is_active ? v.stock_quantity : 0), 0);
}

export default function CatalogoScreen() {
  const colorScheme = useColorScheme();
  const c = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState('');

  const { data: products = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  });

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );

  const styles = createStyles(c);

  const renderItem = ({ item }: { item: Product }) => {
    const stock = totalStock(item);
    const stockColor = stock === 0 ? c.danger : stock < 5 ? c.warning : c.success;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/(tabs)/catalogo/${item.id}`)}
        activeOpacity={0.75}
      >
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.productImage} resizeMode="cover" />
        ) : (
          <View style={[styles.productImage, styles.imagePlaceholder]}>
            <Text style={styles.placeholderEmoji}>👕</Text>
          </View>
        )}
        <View style={styles.cardContent}>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{item.category}</Text>
          </View>
          <View style={styles.stockRow}>
            <View style={[styles.stockDot, { backgroundColor: stockColor }]} />
            <Text style={[styles.stockText, { color: stockColor }]}>
              {stock === 0 ? 'Sem stock' : `${stock} em stock`}
            </Text>
          </View>
        </View>
        <View style={styles.cardAction}>
          <Ionicons
            name={isAdmin ? 'create-outline' : 'chevron-forward'}
            size={isAdmin ? 20 : 22}
            color={isAdmin ? c.primary : c.textTertiary}
          />
          {isAdmin && <Text style={styles.editLabel}>Editar</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Catálogo</Text>
          <Text style={styles.headerSubtitle}>{products.length} artigo{products.length !== 1 ? 's' : ''}</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/(tabs)/catalogo/novo')}
            activeOpacity={0.8}
          >
            <Text style={styles.addButtonText}>+ Novo</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Pesquisa */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Pesquisar por nome ou categoria..."
          placeholderTextColor={c.textTertiary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Text style={styles.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Lista */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>{search ? '🔍' : '✨'}</Text>
              <Text style={styles.emptyTitle}>
                {search ? 'Nenhum resultado' : 'Tudo novo por aqui!'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {search
                  ? `Não encontrámos nada para "${search}".`
                  : 'Começa por adicionar o teu primeiro artigo.'}
              </Text>
              {!search && isAdmin && (
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => router.push('/(tabs)/catalogo/novo')}
                >
                  <Text style={styles.emptyButtonText}>+ Adicionar artigo</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(c: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
    },
    headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, color: c.text, letterSpacing: -0.5 },
    headerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: c.textSecondary, marginTop: 2 },
    addButton: {
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    addButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#fff' },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      marginHorizontal: 20,
      marginBottom: 16,
      borderRadius: 14,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: c.border,
      gap: 10,
    },
    searchIcon: { fontSize: 16 },
    searchInput: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.text,
      paddingVertical: 14,
    },
    clearIcon: { fontSize: 14, color: c.textTertiary, paddingHorizontal: 4 },
    list: { paddingHorizontal: 20, paddingBottom: 100 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: 16,
      marginBottom: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 4,
      elevation: 2,
      gap: 14,
    },
    productImage: { width: 68, height: 68, borderRadius: 12 },
    imagePlaceholder: { backgroundColor: c.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
    placeholderEmoji: { fontSize: 28 },
    cardContent: { flex: 1, gap: 6 },
    productName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.text, lineHeight: 20 },
    categoryBadge: {
      alignSelf: 'flex-start',
      backgroundColor: c.primaryLight,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    categoryText: { fontFamily: 'Inter_500Medium', fontSize: 11, color: c.primary },
    stockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stockDot: { width: 8, height: 8, borderRadius: 4 },
    stockText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
    cardAction: { minWidth: 46, alignItems: 'center', justifyContent: 'center', gap: 3 },
    editLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: c.primary },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyState: { alignItems: 'center', paddingTop: 80, gap: 12 },
    emptyEmoji: { fontSize: 52 },
    emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: c.text },
    emptySubtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: c.textSecondary, textAlign: 'center' },
    emptyButton: {
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingHorizontal: 24,
      paddingVertical: 14,
      marginTop: 8,
    },
    emptyButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#fff' },
  });
}
