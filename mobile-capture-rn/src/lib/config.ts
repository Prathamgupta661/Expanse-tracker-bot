import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CaptureConfig } from "./types";

const CONFIG_KEY = "capture_config_v1";

export const DEFAULT_CONFIG: CaptureConfig = {
  // Inlined at build time from .env locally, or from EAS environment variables in cloud builds.
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  userId: "",
  secret: "",
  notificationEnabled: true,
  smsEnabled: true,
  appFilters:
    "com.google.android.apps.nbu.paisa.user,com.phonepe.app,net.one97.paytm,in.org.npci.upiapp,com.google.android.apps.messaging,com.android.mms,com.samsung.android.messaging",
  smsFilters: "hdfcbk,icicib,sbiinb,axisbk,boiind",
};

export async function loadConfig(): Promise<CaptureConfig> {
  const raw = await AsyncStorage.getItem(CONFIG_KEY);
  if (!raw) {
    return DEFAULT_CONFIG;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CaptureConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      // A previously saved empty URL should not hide the build-time default.
      baseUrl: parsed.baseUrl?.trim() || DEFAULT_CONFIG.baseUrl,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: CaptureConfig): Promise<void> {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
