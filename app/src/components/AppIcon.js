// One icon family (Feather) for the whole app. Names come from a fixed list, so
// an admin-chosen icon key can never reference something we do not ship.
import React from 'react';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme';

export const ICONS = ['smartphone', 'users', 'shopping-bag', 'package', 'tool', 'heart', 'edit-3', 'search', 'chevron-right', 'chevron-left', 'grid', 'home', 'check', 'x', 'message-circle', 'star', 'map-pin', 'calendar', 'clock', 'user', 'clipboard', 'help-circle', 'wifi', 'printer', 'truck', 'coffee', 'book-open', 'scissors', 'sun', 'shield', 'bell', 'list'];

export default function AppIcon({ name, size = 24, color = colors.accent, style }) {
  const safe = ICONS.includes(name) ? name : 'grid';
  return <Feather name={safe} size={size} color={color} style={style} accessible={false} importantForAccessibility="no" />;
}
