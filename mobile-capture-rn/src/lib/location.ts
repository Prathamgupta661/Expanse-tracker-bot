import * as Location from "expo-location";

import type { PaymentLocation } from "./types";

// A fix this recent is close enough to where the payment happened, and avoids waiting on GPS.
const MAX_LAST_KNOWN_AGE_MS = 5 * 60 * 1000;
// The notification headless task times out after 15s, so leave time for the upload.
const FRESH_FIX_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Payments are mostly captured while the app is in the background, which on Android 10+
 * requires the "Allow all the time" (background) location permission.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    return false;
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted;
}

/** Best effort: returns null instead of throwing, so a missing location never blocks a capture. */
export async function getPaymentLocation(): Promise<PaymentLocation | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) {
      return null;
    }

    const position =
      (await Location.getLastKnownPositionAsync({ maxAge: MAX_LAST_KNOWN_AGE_MS })) ??
      (await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        FRESH_FIX_TIMEOUT_MS,
      ));
    if (!position) {
      return null;
    }

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
      capturedAt: new Date(position.timestamp).toISOString(),
    };
  } catch {
    return null;
  }
}
