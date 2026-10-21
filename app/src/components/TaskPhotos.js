// Proof-of-work photos for one task. Everyone on the task can look; only the
// assigned Personal Manager can add or remove, and only while the work is active.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius } from '../theme';
import { Card, Button, ErrorText } from './UI';
import { listPhotos, uploadPhoto, removePhoto } from '../data/extras';
import { enqueuePhoto, isNetworkError, processQueue, useOfflineQueue } from '../data/offlineQueue';
import OfflineSyncBanner from './OfflineSyncBanner';

const KIND_LABEL = { before: 'Before', after: 'After', other: 'Photo' };
const MAX_BYTES = 10 * 1024 * 1024;

export default function TaskPhotos({ taskId, canAdd, hideIfEmpty }) {
  const [photos, setPhotos] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await listPhotos(taskId);
    setPhotos(r.photos); setUnavailable(r.unavailable);
  }, [taskId]);
  useEffect(() => { load(); }, [load]);
  const { items: queued } = useOfflineQueue();
  const waiting = queued.length;
  useEffect(() => { processQueue().then(load); }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  if (unavailable || photos === null) return null;
  if (hideIfEmpty && !photos.length && !canAdd) return null;

  async function add(kind) {
    setError('');
    const res = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const file = res.assets[0];
    if (file.size && file.size > MAX_BYTES) { setError('That photo is over 10 MB. Pick a smaller one.'); return; }
    setBusy(kind);
    try { await uploadPhoto(taskId, kind, file); await load(); }
    catch (e) {
      if (isNetworkError(e)) { await enqueuePhoto(taskId, kind, file); setError(''); }      // no signal: keep it and send later
      else setError(e.message);
    } finally { setBusy(''); }
  }

  async function remove(p) {
    setError('');
    try { await removePhoto(p); await load(); } catch (e) { setError(e.message); }
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <Text style={styles.h2}>Proof of work</Text>
      {!photos.length && <Text style={styles.hint}>{canAdd ? 'Add a before and after photo so there is a record of the job.' : 'No photos yet.'}</Text>}
      <View style={styles.grid}>
        {photos.map((p) => (
          <View key={p.id} style={styles.cell}>
            {p.url ? <Image source={{ uri: p.url }} style={styles.img} resizeMode="cover" /> : <View style={[styles.img, styles.missing]}><Text style={styles.hint}>Unavailable</Text></View>}
            <Text style={styles.kind}>{KIND_LABEL[p.kind] || 'Photo'}</Text>
            {canAdd && (
              <Pressable onPress={() => remove(p)} hitSlop={6}><Text style={styles.remove}>Remove</Text></Pressable>
            )}
          </View>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
      <OfflineSyncBanner taskId={taskId} />
      {canAdd && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={busy === 'before' ? 'Uploading…' : '+ Before'} variant="ghost" size="sm" style={{ flex: 1 }} disabled={!!busy} onPress={() => add('before')} />
          <Button label={busy === 'after' ? 'Uploading…' : '+ After'} variant="ghost" size="sm" style={{ flex: 1 }} disabled={!!busy} onPress={() => add('after')} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: '47%', gap: 4 },
  img: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  missing: { alignItems: 'center', justifyContent: 'center' },
  kind: { fontSize: 12, fontWeight: '700', color: colors.text },
  remove: { fontSize: 12, fontWeight: '700', color: colors.danger },
});
