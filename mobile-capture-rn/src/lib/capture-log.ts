import AsyncStorage from "@react-native-async-storage/async-storage";

const LOG_KEY = "capture_log_v1";
const LISTENER_SEEN_KEY = "capture_listener_seen_v1";
const MAX_ENTRIES = 30;
// Long enough to keep the whole notification/SMS, so a skipped entry can be resent as-is.
const PREVIEW_LENGTH = 1000;

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

/** Entries are identified by their timestamp, which is unique in practice for this log. */
export function updateCaptureLogResult(at: string, result: string): Promise<void> {
  return withLogLock(async () => {
    const log = await readLog();
    const next = log.map((entry) => (entry.at === at ? { ...entry, result } : entry));
    await AsyncStorage.setItem(LOG_KEY, JSON.stringify(next));
  });
}

export function readCaptureLog(): Promise<CaptureLogEntry[]> {
  return withLogLock(readLog);
}

export function clearCaptureLog(): Promise<void> {
  return withLogLock(() => AsyncStorage.multiRemove([LOG_KEY, LISTENER_APPS_KEY]));
}

export interface ListenerAppSeen {
  source: string;
  at: string;
  count: number;
}

const LISTENER_APPS_KEY = "capture_listener_apps_v1";
const MAX_LISTENER_APPS = 20;

async function readListenerAppsMap(): Promise<Record<string, ListenerAppSeen>> {
  const raw = await AsyncStorage.getItem(LISTENER_APPS_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, ListenerAppSeen>;
  } catch {
    return {};
  }
}

/**
 * Records that the notification listener fired, for any app, to prove it is alive. Also keeps a
 * per-app count, because the single "last fired" value is usually overwritten by chat apps.
 */
export function recordListenerSeen(source: string | null): Promise<void> {
  return withLogLock(async () => {
    const at = new Date().toISOString();
    const seen: ListenerSeen = { at, source };
    await AsyncStorage.setItem(LISTENER_SEEN_KEY, JSON.stringify(seen));

    const key = source ?? "unknown app";
    const apps = await readListenerAppsMap();
    apps[key] = { source: key, at, count: (apps[key]?.count ?? 0) + 1 };
    const kept = Object.values(apps)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_LISTENER_APPS);
    await AsyncStorage.setItem(
      LISTENER_APPS_KEY,
      JSON.stringify(Object.fromEntries(kept.map((item) => [item.source, item]))),
    );
  });
}

/** Most recently seen first. */
export async function readListenerApps(): Promise<ListenerAppSeen[]> {
  const apps = await readListenerAppsMap();
  return Object.values(apps).sort((a, b) => b.at.localeCompare(a.at));
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
