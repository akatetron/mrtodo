// The call button is part of the screen so people know where it will be, but no
// calling provider is connected yet, and this button says so instead of
// pretending. Access follows the task: only the customer and the accepted
// Personal Manager see it, and only while the task is under way. Phone numbers
// are never shown here.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { colors } from '../theme';
import { Button } from './UI';

export default function InAppCallButton({ t }) {
  const [shown, setShown] = useState(false);
  if (!['assigned', 'in_progress'].includes(t.status)) return null;
  return (
    <View style={{ gap: 6 }}>
      <Button label="📞 In-App Call" variant="ghost" onPress={() => setShown(true)} />
      {shown && (
        <Text style={{ fontSize: 15, lineHeight: 22, color: colors.text }} accessibilityLiveRegion="polite">
          In-app calling is not available yet. For now, use the messages and notifications in the app. Your number is never shared with the other person.
        </Text>
      )}
    </View>
  );
}
