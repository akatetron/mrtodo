// One category: its published services as a clean list, and a way to ask for
// something that is not listed.
import React from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, spacing, radius, typo, pagePad } from '../theme';
import { ScreenHeader, ServiceListItem, GeneralRequestEntry } from '../components/discover/Discover';
import { useCatalogue } from '../data/useCatalogue';

export default function CategoryScreen({ navigation, route }) {
  const { familyId } = route.params;
  const { families, loaded } = useCatalogue();
  const { width } = useWindowDimensions();
  const pad = pagePad(width);
  const family = families.find((f) => f.id === familyId);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 48, paddingTop: 4 }}>
      <ScreenHeader title={family?.name || 'Services'} subtitle={family?.description} onBack={() => navigation.goBack()} />
      {!family && loaded && <Text style={[s.muted, { marginTop: spacing.xl }]}>This category is not available right now.</Text>}
      {!!family && (
        <View style={s.surface}>
          {family.services.map((svc, i) => {
            const pr = svc.definition.pricing || {};
            const meta = pr.approach === 'fixed' ? `Fixed price ₹${Number(pr.price).toLocaleString('en-IN')}` : 'Quote after we review your request';
            return (
              <ServiceListItem key={svc.id} title={svc.definition.title} description={svc.definition.description} meta={meta}
                last={i === family.services.length - 1} onPress={() => navigation.navigate('Booking', { serviceId: svc.id })} />
            );
          })}
        </View>
      )}
      <GeneralRequestEntry onPress={() => navigation.navigate('Booking', { general: true })} />
    </ScrollView>
  );
}
const s = StyleSheet.create({
  muted: { ...typo.body, color: colors.muted },
  surface: { marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, overflow: 'hidden' },
});
