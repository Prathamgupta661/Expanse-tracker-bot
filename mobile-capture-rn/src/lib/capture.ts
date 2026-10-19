import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";
import NotificationListener, {
  NotificationListenerAndroidHeadlessJsName,
  RNAndroidNotificationListenerHeadlessJsName,
} from "react-native-android-notification-listener";

import type { CaptureConfig, IngestEvent } from "./types";
import { appendCaptureLog, recordListenerSeen } from "./capture-log";
import { loadConfig } from "./config";
import { sendOrQueueDetailed } from "./ingest";
import { getPaymentLocation } from "./location";

export const NOTIFICATION_HEADLESS_TASK_NAME =
  NotificationListenerAndroidHeadlessJsName ||
  RNAndroidNotificationListenerHeadlessJsName ||
  "RNAndroidNotificationListenerHeadlessJsName";

// react-native-sms-receiver native module. Its JS wrapper re-registers the native
// BroadcastReceiver and adds a new emitter listener on every call, so we drive it directly.
const SmsReceiverNative = NativeModules.SmsReceiver as
  | { startReadSMS: (success: (result: unknown) => void, error: (error: unknown) => void) => void }
  | undefined;

let smsNativeStarted = false;
let smsSubscription: { remove: () => void } | null = null;

async function makeEvent(params: {
  channel: "notification" | "sms";
  message: string;
  source: string | null;
  config: CaptureConfig;
}): Promise<IngestEvent> {
  const capturedAt = new Date().toISOString();
  return {
    eventId: `${params.channel}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`,
    channel: params.channel,
    message: params.message,
    appOrSender: params.source,
    capturedAt,
    // Looked up only for events that passed the filters, so other notifications cost nothing.
    location: params.config.locationEnabled ? await getPaymentLocation() : null,
  };
}

function shouldMatchFilter(value: string | null, csv: string): boolean {
  const filters = csv
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!filters.length) {
    return true;
  }

  const source = (value || "").toLowerCase();
  return filters.some((filter) => source.includes(filter));
}

const DEBIT_WORDS = ["upi", "paid", "debited", "sent", "payment"];
const NON_DEBIT_WORDS = ["pending", "failed", "refund", "credited", "request", "collect"];

function mentionsPayment(message: string): boolean {
  const text = message.toLowerCase();
  return DEBIT_WORDS.some((word) => text.includes(word));
}

/** Returns why the message is not treated as a debit, or null if it looks like one. */
function debitRejection(message: string): string | null {
  if (!mentionsPayment(message)) {
    return "no payment keyword";
  }
  const text = message.toLowerCase();
  // "debited A/c... and credited to <payee>" is still a debit; "credited" names the payee there.
  const isExplicitDebit = text.includes("debited");
  const blocked = NON_DEBIT_WORDS.find(
    (word) => text.includes(word) && !(isExplicitDebit && word === "credited"),
  );
  return blocked ? `contains "${blocked}"` : null;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return false;
  }

  const status = await NotificationListener.getPermissionStatus();
  if (status === "authorized") {
    return true;
  }

  const next = await NotificationListener.requestPermission();
  return next === "authorized";
}

export async function ensureSmsPermission(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return false;
  }

  const receiveGranted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  );
  const readGranted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  );

  return (
    receiveGranted === PermissionsAndroid.RESULTS.GRANTED &&
    readGranted === PermissionsAndroid.RESULTS.GRANTED
  );
}

/**
 * The native module emits a hand-built string `{ "address": "...", "message": "..."}` without
 * escaping, so quotes or newlines in the SMS break JSON.parse. Fall back to a tolerant regex.
 */
function parseSmsEvent(raw: unknown): { sender: string | null; body: string } {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      sender: typeof obj.address === "string" ? obj.address : null,
      body: typeof obj.message === "string" ? obj.message : "",
    };
  }
  if (typeof raw !== "string") {
    return { sender: null, body: "" };
  }

  try {
    return parseSmsEvent(JSON.parse(raw));
  } catch {
    const match = /^\{\s*"address":\s*"([\s\S]*?)",\s*"message":\s*"([\s\S]*)"\s*\}$/.exec(raw.trim());
    return match ? { sender: match[1] || null, body: match[2] } : { sender: null, body: "" };
  }
}

export function stopSmsListener(): void {
  smsSubscription?.remove();
  smsSubscription = null;
}

/** SMS capture only works while the app's JS runtime is alive (the receiver is not a manifest receiver). */
export async function startSmsListener(config: CaptureConfig): Promise<void> {
  if (Platform.OS !== "android" || !config.smsEnabled || !SmsReceiverNative) {
    return;
  }

  const hasReceive = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
  const hasRead = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  if (!hasReceive || !hasRead) {
    return;
  }

  stopSmsListener();

  if (!smsNativeStarted) {
    await new Promise<void>((resolve) => {
      SmsReceiverNative.startReadSMS(
        () => {
          smsNativeStarted = true;
          resolve();
        },
        () => resolve(),
      );
    });
  }

  smsSubscription = new NativeEventEmitter(NativeModules.SmsReceiver).addListener("received_sms", (raw: unknown) => {
    void (async () => {
      const { sender, body } = parseSmsEvent(raw);
      const senderMatches = shouldMatchFilter(sender, config.smsFilters);

      // Only log payment candidates, so OTPs and chats from other senders stay out of the log.
      if (!senderMatches && !mentionsPayment(body)) {
        return;
      }
      const log = (result: string) =>
        appendCaptureLog({ channel: "sms", source: sender, preview: body, result });

      if (!body) {
        await log("skipped: could not read SMS text");
        return;
      }

      const rejection = debitRejection(body);
      if (rejection) {
        await log(`skipped: ${rejection}`);
        return;
      }

      if (!senderMatches) {
        await log("skipped: sender not in SMS filters");
        return;
      }

      const result = await sendOrQueueDetailed(
        config,
        await makeEvent({
          channel: "sms",
          message: body,
          source: sender,
          config,
        }),
      );
      await log(result);
    })();
  });
}

function parseNotificationPayload(input: unknown): Record<string, unknown> {
  // The listener library invokes the task with `{ notification: "<JSON string>" }`.
  const inner =
    input && typeof input === "object" && "notification" in input
      ? (input as { notification: unknown }).notification
      : input;

  if (typeof inner === "string") {
    try {
      const parsed = JSON.parse(inner) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : {};
}

export async function notificationHeadlessTask(input: unknown): Promise<void> {
  const config = await loadConfig();
  if (!config.notificationEnabled) {
    return;
  }

  const payloadObj = parseNotificationPayload(input);

  const sourceApp =
    (payloadObj.app as string | undefined) ||
    (payloadObj.packageName as string | undefined) ||
    null;

  const text = [
    payloadObj.title,
    payloadObj.text,
    payloadObj.bigText,
  ]
    .map((item) => (typeof item === "string" ? item : ""))
    .filter(Boolean)
    .join(" - ")
    .trim();

  await recordListenerSeen(sourceApp);

  const appMatches = shouldMatchFilter(sourceApp, config.appFilters);

  // Only log payment candidates, so chat and other app notifications stay out of the log.
  if (!appMatches && !mentionsPayment(text)) {
    return;
  }
  const log = (result: string) =>
    appendCaptureLog({ channel: "notification", source: sourceApp, preview: text, result });

  if (!text) {
    await log("skipped: notification has no text");
    return;
  }

  const rejection = debitRejection(text);
  if (rejection) {
    await log(`skipped: ${rejection}`);
    return;
  }

  if (!appMatches) {
    await log("skipped: app not in notification filters");
    return;
  }

  const event = await makeEvent({
    channel: "notification",
    message: text,
    source: sourceApp,
    config,
  });

  await log(await sendOrQueueDetailed(config, event));
}
