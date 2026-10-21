// Mr. Todo — shared design tokens (Option B: "Warm Professional")
// Mirrors the color system used in the web prototype so the native app
// and the website read as the same brand.

export const colors = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F7F7',
  text: '#12181A',
  muted: '#5B6567',
  faint: '#8A9294',
  border: '#E1E5E5',

  accent: '#123B3F',       // deep teal — primary buttons, links, active states
  accentDark: '#0A2427',
  accentLight: '#E4EEEC',  // pale teal tint — badges, selected chips
  accentText: '#FFFFFF',   // text/icon color on top of accent

  brass: '#C9963B',        // warm secondary highlight (ongoing/warning tone)
  brassLight: '#F6E9D2',
  brassDark: '#7A4E10',

  success: '#2E9E57',          // fills and icons only: too light for small text
  successText: '#1B6B3A',      // accessibility: success-coloured text (4.5:1 on white and on Success Tint)
  successLight: '#E6F5EA',
  danger: '#C0392B',
  dangerLight: '#FBEAE8',
};

// Accessibility rules every screen follows.
export const accessibility = { baseFontSize: 16, minTouchTarget: 48 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 };

// Horizontal page padding: 20, reduced to 16 on very narrow screens (see pagePad()).
export const pagePad = (width) => (width < 360 ? 16 : 20);

export const radius = { xs: 8, sm: 10, md: 12, lg: 16, xl: 24, pill: 999 };

// Customer screens never stretch across a tablet or browser window.
export const maxContentWidth = 640;

// Type scale. Sizes follow the device's text-size setting; nothing is fixed-height.
export const typo = {
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.4 },
  section: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  featured: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  tile: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  service: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
};

export const type = {
  display: { fontWeight: '800', letterSpacing: -0.3 },
  heading: { fontWeight: '700', letterSpacing: -0.2 },
  label: { fontWeight: '700', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  body: { fontWeight: '400', fontSize: 16, lineHeight: 24 },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};
