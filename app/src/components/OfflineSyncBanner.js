import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Button } from './UI';
import { useOfflineQueue, retryAll, discard } from '../data/offlineQueue';

export default function OfflineSyncBanner({ taskId }) {
  const { items } = useOfflineQueue();
  const mine = items.filter((i) => i.taskId === taskId);
  if (!mine.length) return null;
  const failed = mine.filter((i) => i.error);
  return (
    <View style={[styles.box, failed.length > 0 && { borderColor: colors.danger, backgroundColor: colors.dangerLight }]} accessibilityLiveRegion="polite">
      <Text style={styles.title}>{failed.length ? 'A photo could not be sent' : 'Waiting to sync'}</Text>
      <Text style={styles.line}>
        {failed.length
          ? failed[0].error
          : `${mine.length} photo${mine.length === 1 ? '' : 's'} will upload when you are back online. The job is not complete until the server confirms it.`}
      </Text>
      <View style={styles.row}>
        <Button label="Try again now" size="sm" variant="ghost" onPress={retryAll} />
        {failed.map((i) => <Button key={i.id} label={`Discard ${i.kind} photo`} size="sm" variant="danger" onPress={() => discard(i.id)} />)}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  box: { borderWidth: 2, borderColor: colors.brass, backgroundColor: colors.brassLight, borderRadius: 14, padding: spacing.md, gap: 6 },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  line: { fontSize: 15, lineHeight: 22, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
