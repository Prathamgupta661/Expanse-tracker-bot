declare module "react-native-android-notification-listener" {
  export const RNAndroidNotificationListenerHeadlessJsName: string;
  export const NotificationListenerAndroidHeadlessJsName: string;

  export function getPermissionStatus(): Promise<"authorized" | "denied" | string>;
  export function requestPermission(): Promise<"authorized" | "denied" | string>;

  const _default: {
    getPermissionStatus: typeof getPermissionStatus;
    requestPermission: typeof requestPermission;
  };

  export default _default;
}

declare module "react-native-sms-receiver" {
  const SmsReceiver: {
    addListener?: (callback: (event: { originatingAddress?: string; body?: string }) => void) => {
      remove?: () => void;
    };
    startSmsRetriever?: () => Promise<void>;
  };

  export default SmsReceiver;
}

// Expo inlines EXPO_PUBLIC_* variables at build time.
declare const process: {
  env: {
    EXPO_PUBLIC_API_BASE_URL?: string;
  };
};
