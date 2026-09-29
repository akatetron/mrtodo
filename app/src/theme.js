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

  success: '#2E9E57',
  successLight: '#E6F5EA',
  danger: '#C0392B',
  dangerLight: '#FBEAE8',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const type = {
  display: { fontWeight: '800', letterSpacing: -0.3 },
  heading: { fontWeight: '700', letterSpacing: -0.2 },
  label: { fontWeight: '700', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  body: { fontWeight: '400', fontSize: 15, lineHeight: 22 },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};
