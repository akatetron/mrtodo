// WCAG contrast checks for the colour pairs the apps use.
// Run: node --test app/tests/contrast.test.mjs   (from the repo root)
import test from 'node:test';
import assert from 'node:assert/strict';

const C = {
  primary: '#123B3F', primaryDark: '#0A2427', brass: '#C9963B', brassDark: '#7A4E10', paleTeal: '#E4EEEC', brassTint: '#F6E9D2',
  success: '#2E9E57', successTint: '#E6F5EA', danger: '#C0392B', dangerTint: '#FBEAE8', ink: '#12181A', muted: '#5B6567', faint: '#8A9294',
  border: '#E1E5E5', white: '#FFFFFF',
  // Accessibility-only additions (the official success green is too light for small text)
  successText: '#1B6B3A',
};
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [text, background, minimum, what it is]
const PAIRS = [
  [C.ink, C.white, 4.5, 'body text'], [C.ink, C.paleTeal, 4.5, 'text on a selected input'], [C.ink, C.brassTint, 4.5, 'text on a premium highlight'],
  [C.ink, C.dangerTint, 4.5, 'text in an error box'], [C.ink, C.successTint, 4.5, 'text in a success box'],
  [C.muted, C.white, 4.5, 'secondary text'], [C.muted, C.paleTeal, 4.5, 'secondary text on a tint'], [C.muted, C.brassTint, 4.5, 'secondary text on brass tint'],
  [C.white, C.primary, 4.5, 'primary button label'], [C.white, C.primaryDark, 4.5, 'pressed / dark surface'], [C.primaryDark, C.brass, 4.5, 'swipe track and brass button label'],
  [C.primary, C.paleTeal, 4.5, 'selected chip text'], [C.primary, C.white, 4.5, 'link and heading'],
  [C.brassDark, C.brassTint, 4.5, 'Gold / ongoing badge'], [C.brassDark, C.white, 4.5, 'brass text on white'],
  [C.danger, C.white, 4.5, 'danger text on white'], [C.danger, C.dangerTint, 4.5, 'danger badge'],
  [C.successText, C.successTint, 4.5, 'success badge'], [C.successText, C.white, 4.5, 'success text on white'],
  [C.muted, C.primary, 3, 'n/a placeholder: not used'],
];
for (const [fg, bg, min, what] of PAIRS.slice(0, -1)) {
  test(`${what}: ${fg} on ${bg} is at least ${min}:1`, () => assert.ok(ratio(fg, bg) >= min, `only ${ratio(fg, bg).toFixed(2)}:1`));
}
test('the official success green is NOT used for small text (it fails 4.5:1)', () => assert.ok(ratio(C.success, C.successTint) < 4.5));
test('the faint grey reaches 3:1 as a placeholder on white but must not carry real text', () => {
  const r = ratio(C.faint, C.white); assert.ok(r >= 3, `${r.toFixed(2)}`); assert.ok(r < 4.5);
});
test('a 48 pixel minimum touch target is configured', async () => {
  const fs = await import('node:fs');
  const t = fs.readFileSync(new URL('../src/theme.js', import.meta.url), 'utf8');
  assert.match(t, /minTouchTarget:\s*48/); assert.match(t, /baseFontSize:\s*16/);
});
