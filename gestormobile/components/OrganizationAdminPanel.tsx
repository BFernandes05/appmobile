import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/hooks/useOrganization';
import type { ColorScheme } from '@/constants/colors';

const BUSINESS_TYPES = [
  { value: 'retail', label: 'Retalho' },
  { value: 'fashion', label: 'Moda' },
  { value: 'beauty', label: 'Beleza' },
  { value: 'services', label: 'Serviços' },
  { value: 'food', label: 'Alimentação' },
];

export function OrganizationAdminPanel({ colors }: { colors: ColorScheme }) {
  const { organizationId, organization, settings, canManage, loading } = useOrganization();
  const queryClient = useQueryClient();
  const [brandName, setBrandName] = useState(settings.brand_name);
  const [businessType, setBusinessType] = useState(settings.business_type);
  const [singular, setSingular] = useState(settings.item_singular);
  const [plural, setPlural] = useState(settings.item_plural);
  const [reservations, setReservations] = useState(settings.reservations_enabled);
  const [referrals, setReferrals] = useState(settings.referrals_enabled);
  const [customerStore, setCustomerStore] = useState(settings.customer_store_enabled);
  const styles = createStyles(colors);

  useEffect(() => {
    setBrandName(settings.brand_name);
    setBusinessType(settings.business_type);
    setSingular(settings.item_singular);
    setPlural(settings.item_plural);
    setReservations(settings.reservations_enabled);
    setReferrals(settings.referrals_enabled);
    setCustomerStore(settings.customer_store_enabled);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('A fundação multiempresa ainda não foi ativada na base de dados.');
      const { error } = await supabase.from('organization_settings').update({
        brand_name: brandName.trim(),
        business_type: businessType,
        item_singular: singular.trim(),
        item_plural: plural.trim(),
        reservations_enabled: reservations,
        referrals_enabled: referrals,
        customer_store_enabled: customerStore,
        updated_at: new Date().toISOString(),
      }).eq('organization_id', organizationId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      Alert.alert('Empresa atualizada', 'A identidade e os módulos foram guardados.');
    },
    onError: (error: Error) => Alert.alert('Não foi possível guardar', error.message),
  });

  if (loading) return <ActivityIndicator color={colors.primary} />;

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.iconBox}><Ionicons name="business" size={22} color={colors.primary} /></View>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>ESPAÇO DE TRABALHO</Text>
          <Text style={styles.title}>{organization?.name ?? 'A tua empresa'}</Text>
          <Text style={styles.subtitle}>Plano {organization?.plan ?? 'Business'} · personalização multi-nicho</Text>
        </View>
        <View style={styles.status}><Text style={styles.statusText}>Ativo</Text></View>
      </View>

      <View style={styles.formGrid}>
        <View style={styles.field}>
          <Text style={styles.label}>Nome apresentado</Text>
          <TextInput value={brandName} onChangeText={setBrandName} style={styles.input} placeholder="Nome da marca" placeholderTextColor={colors.textTertiary} editable={canManage || !organizationId} />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Terminologia</Text>
          <View style={styles.inlineInputs}>
            <TextInput value={singular} onChangeText={setSingular} style={[styles.input, styles.halfInput]} placeholder="artigo" placeholderTextColor={colors.textTertiary} editable={canManage || !organizationId} />
            <TextInput value={plural} onChangeText={setPlural} style={[styles.input, styles.halfInput]} placeholder="artigos" placeholderTextColor={colors.textTertiary} editable={canManage || !organizationId} />
          </View>
        </View>
      </View>

      <Text style={styles.label}>Tipo de negócio</Text>
      <View style={styles.chips}>
        {BUSINESS_TYPES.map((item) => (
          <TouchableOpacity key={item.value} onPress={() => setBusinessType(item.value)} style={[styles.chip, businessType === item.value && styles.chipActive]}>
            <Text style={[styles.chipText, businessType === item.value && styles.chipTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.modules}>
        <ModuleSwitch label="Loja para clientes" description="Catálogo, carrinho e pedidos" value={customerStore} onValueChange={setCustomerStore} colors={colors} />
        <ModuleSwitch label="Reservas" description="Stock reservado com validade" value={reservations} onValueChange={setReservations} colors={colors} />
        <ModuleSwitch label="Recompensas" description="Referências e vouchers" value={referrals} onValueChange={setReferrals} colors={colors} />
      </View>

      <TouchableOpacity accessibilityRole="button" onPress={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={styles.saveButton}>
        {saveMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Guardar configuração</Text>}
      </TouchableOpacity>
    </View>
  );
}

function ModuleSwitch({ label, description, value, onValueChange, colors }: { label: string; description: string; value: boolean; onValueChange: (value: boolean) => void; colors: ColorScheme }) {
  const styles = createStyles(colors);
  return <View style={styles.moduleRow}><View style={styles.moduleCopy}><Text style={styles.moduleTitle}>{label}</Text><Text style={styles.moduleDescription}>{description}</Text></View><Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: colors.primary }} /></View>;
}

function createStyles(c: ColorScheme) {
  return StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 20, gap: 18 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    iconBox: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center' },
    headingCopy: { flex: 1 }, eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1, color: c.primary },
    title: { fontFamily: 'Inter_700Bold', fontSize: 20, color: c.text }, subtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.textSecondary, marginTop: 2 },
    status: { backgroundColor: c.successLight, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 }, statusText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: c.success },
    formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, field: { flex: 1, minWidth: 240, gap: 7 },
    label: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: c.textSecondary }, input: { minHeight: 44, backgroundColor: c.surfaceSecondary, borderRadius: 10, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: 12, fontFamily: 'Inter_500Medium' },
    inlineInputs: { flexDirection: 'row', gap: 8 }, halfInput: { flex: 1 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: c.border, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8 }, chipActive: { backgroundColor: c.primary, borderColor: c.primary }, chipText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: c.textSecondary }, chipTextActive: { color: '#fff' },
    modules: { borderTopWidth: 1, borderTopColor: c.border }, moduleRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.border }, moduleCopy: { flex: 1 }, moduleTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: c.text }, moduleDescription: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.textSecondary, marginTop: 2 },
    saveButton: { alignSelf: 'flex-end', minWidth: 190, minHeight: 44, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 }, saveText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: '#fff' },
  });
}
