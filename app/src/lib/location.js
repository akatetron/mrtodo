// A one-off reading of where the phone is, asked for only when the person taps
// "Use my current location". Nothing is tracked in the background.
import { Platform } from 'react-native';

export async function currentPoint() {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(5)), lng: Number(p.coords.longitude.toFixed(5)) }),
      () => reject(new Error('Location is switched off for this site. You can type the address instead.')),
      { timeout: 10000 },
    ));
  }
  const Location = require('expo-location');
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') throw new Error('Location is switched off for Mr. Todo. You can type the address instead, or turn it on in your phone settings.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: Number(p.coords.latitude.toFixed(5)), lng: Number(p.coords.longitude.toFixed(5)) };
}

// Opens the phone's maps app at an address (or a point when we have one).
export function mapsUrl(address, lat, lng) {
  const q = lat != null && lng != null ? `${lat},${lng}` : encodeURIComponent(address || '');
  return Platform.select({ ios: `http://maps.apple.com/?daddr=${q}`, android: `geo:0,0?q=${q}`, default: `https://www.google.com/maps/dir/?api=1&destination=${q}` });
}
