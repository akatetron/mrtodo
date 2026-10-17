// Contact details are not part of a profile any more. An admin taps to reveal
// them, and the database records each lookup in the audit log.
import React, { useState } from 'react';
import { Text } from 'react-native';
import { colors } from '../theme';
import { Button } from './UI';
import { adminContacts } from '../data/store';

export default function AdminContact({ personId, style }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reveal() {
    setBusy(true); setError('');
    try { setInfo((await adminContacts([personId]))[personId] || {}); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (info) return <Text style={style}>{[info.phone, info.email].filter(Boolean).join(' · ') || 'No contact details'}</Text>;
  return (
    <>
      <Button label={busy ? 'Loading…' : 'Show contact details (recorded)'} variant="ghost" onPress={reveal} disabled={busy} />
      {!!error && <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>}
    </>
  );
}
