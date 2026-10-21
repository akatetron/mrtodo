// One category: a photograph (or the fallback artwork), an honest introduction, its
// published services, and a way to ask for something that is not listed.
import React from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, spacing, radius, typo, pagePad, maxContentWidth } from '../theme';
import { ScreenHeader, ServiceListItem } from '../components/discover/Discover';
import { ServicePhoto, DescribeTaskRow, PriceOrQuoteSummary } from '../components/concierge/Concierge';
import { useCatalogue } from '../data/useCatalogue';

export default function CategoryScreen({ navigation, route }) {
  const { familyId } = route.params;
  const { families, loaded } = useCatalogue();
  const { width } = useWindowDimensions();
  const pad = pagePad(width);
  const family = families.find((f) => f.id === familyId);
  const index = Math.max(0, families.findIndex((f) => f.id === familyId));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 56 }}>
      <View style={{ width: '100%', maxWidth: maxContentWidth, paddingHorizontal: pad }}>
        <ScreenHeader title={family?.name || 'Services'} subtitle={family?.description} onBack={() => navigation.goBack()} />
        {family && (
          <View style={{ marginTop: spacing.lg }}>
            <ServicePhoto photoKey={family.key} uri={family.image_url} alt={family.image_alt} icon={family.icon_key || 'grid'} index={index} ratio={16 / 9} radiusSize={radius.xl} />
          </View>
        )}
        {!family && loaded && <Text style={[s.muted, { marginTop: spacing.xl }]}>This category is not available right now.</Text>}
        {!!family && (
          <>
            <Text style={s.head} accessibilityRole="header">Choose what you need</Text>
            <View style={s.surface}>
              {family.services.map((svc, i) => (
                <ServiceListItem key={svc.id} title={svc.definition.title} description={svc.definition.description}
                  meta={<PriceOrQuoteSummary pricing={svc.definition.pricing} compact />}
                  last={i === family.services.length - 1} onPress={() => navigation.navigate('Booking', { serviceId: svc.id })} />
              ))}
            </View>
          </>
        )}
        <View style={{ marginTop: spacing.xl }}><DescribeTaskRow onPress={() => navigation.navigate('Booking', { general: true })} /></View>
      </View>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  muted: { ...typo.body, color: colors.muted },
  head: { ...typo.section, color: colors.text, marginTop: spacing.xl },
  surface: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, overflow: 'hidden' },
});
