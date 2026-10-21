// Swipe the handle all the way across to confirm. Screen-reader users and anyone
// who prefers not to swipe get a plain button that does the same thing.
import React, { useRef, useState } from 'react';
import { View, Text, Animated, PanResponder, AccessibilityInfo, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';
import { Button } from './UI';

const HANDLE = 56;

export default function SwipeToConfirm({ label, onConfirm, disabled, busy, alternativeLabel }) {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);
  React.useEffect(() => { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion.current = !!v; }).catch(() => {}); }, []);
  const live = useRef({ width: 0, disabled: false, onConfirm });
  live.current = { width, disabled: disabled || busy, onConfirm };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !live.current.disabled,
    onMoveShouldSetPanResponder: () => !live.current.disabled,
    onPanResponderMove: (_, g) => { x.setValue(Math.max(0, Math.min(g.dx, live.current.width - HANDLE))); },
    onPanResponderRelease: (_, g) => {
      const max = live.current.width - HANDLE;
      if (!live.current.disabled && max > 0 && g.dx >= max * 0.92) live.current.onConfirm();
      if (reduceMotion.current) x.setValue(0); else Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();      // always return: nothing is final until the server says so
    },
  })).current;

  return (
    <View style={{ gap: 10 }}>
      <View
        style={[styles.track, disabled && { opacity: 0.5 }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible accessibilityRole="button" accessibilityLabel={alternativeLabel || label} accessibilityState={{ disabled: !!(disabled || busy) }}
        accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={() => !disabled && !busy && onConfirm()}
      >
        <Text style={styles.label}>{busy ? 'Submitting…' : label}</Text>
        <Animated.View style={[styles.handle, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>
          <Text style={styles.arrow}>›</Text>
        </Animated.View>
      </View>
      <Button label={alternativeLabel || 'Submit without swiping'} variant="ghost" onPress={onConfirm} disabled={disabled || busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: HANDLE + 8, borderRadius: radius.pill, backgroundColor: colors.brass, justifyContent: 'center', padding: 4, overflow: 'hidden' },
  label: { textAlign: 'center', fontSize: 16, fontWeight: '800', color: colors.accentDark, paddingHorizontal: HANDLE + 8 },
  handle: { position: 'absolute', left: 4, top: 4, width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, backgroundColor: colors.accentDark, alignItems: 'center', justifyContent: 'center' },
  arrow: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', marginTop: -3 },
});
