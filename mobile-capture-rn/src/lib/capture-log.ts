import AsyncStorage from "@react-native-async-storage/async-storage";

const LOG_KEY = "capture_log_v1";
const LISTENER_SEEN_KEY = "capture_listener_seen_v1";
const MAX_ENTRIES = 30;
const PREVIEW_LENGTH = 160;

export interface CaptureLogEntry {
  at: string;
  channel: "notification" | "sms";
  source: string | null;
  preview: string;
  result: string;
}

export interface ListenerSeen {
  at: string;
  source: string | null;
}

async function readLog(): Promise<CaptureLogEntry[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as CaptureLogEntry[];
  } catch {
    return [];
  }
}

// Same reasoning as the queue lock in ingest.ts: the headless task and the UI share one JS
// runtime, so concurrent appends must not overwrite each other.
let logLock: Promise<unknown> = Promise.resolve();
function withLogLock<T>(task: () => Promise<T>): Promise<T> {
  const run = logLock.then(task, task);
  logLock = run.catch(() => undefined);
  return run;
}

/** Newest first, capped at MAX_ENTRIES. Stored only on the device. */
export function appendCaptureLog(entry: Omit<CaptureLogEntry, "at">): Promise<void> {
  return withLogLock(async () => {
    const log = await readLog();
    log.unshift({
      ...entry,
      preview: entry.preview.slice(0, PREVIEW_LENGTH),
      at: new Date().toISOString(),
    });
    await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, MAX_ENTRIES)));
  });
}

export function readCaptureLog(): Promise<CaptureLogEntry[]> {
  return withLogLock(readLog);
}

export function clearCaptureLog(): Promise<void> {
  return withLogLock(() => AsyncStorage.removeItem(LOG_KEY));
}

/** Records that the notification listener fired at all, for any app, to prove it is alive. */
export async function recordListenerSeen(source: string | null): Promise<void> {
  const seen: ListenerSeen = { at: new Date().toISOString(), source };
  await AsyncStorage.setItem(LISTENER_SEEN_KEY, JSON.stringify(seen));
}

export async function readListenerSeen(): Promise<ListenerSeen | null> {
  const raw = await AsyncStorage.getItem(LISTENER_SEEN_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ListenerSeen;
  } catch {
    return null;
  }
}
