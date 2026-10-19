import AsyncStorage from "@react-native-async-storage/async-storage";
import CryptoJS from "crypto-js";

import type { CaptureConfig, IngestEvent } from "./types";

const QUEUE_KEY = "capture_queue_v1";

function sanitizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

async function readQueue(): Promise<IngestEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as IngestEvent[];
  } catch {
    return [];
  }
}

async function writeQueue(events: IngestEvent[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(events));
}

// Serializes queue read-modify-write cycles. The headless notification task and the UI share
// one JS runtime, so without this a concurrent enqueue during a flush could be overwritten.
let queueLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queueLock.then(task, task);
  queueLock = run.catch(() => undefined);
  return run;
}

export function enqueueEvent(event: IngestEvent): Promise<void> {
  return withQueueLock(async () => {
    const queue = await readQueue();
    if (!queue.some((item) => item.eventId === event.eventId)) {
      queue.push(event);
    }
    await writeQueue(queue);
  });
}

export function flushQueue(config: CaptureConfig): Promise<{ sent: number; failed: number; dropped: number }> {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const pending: IngestEvent[] = [];
    let sent = 0;
    let failed = 0;
    let dropped = 0;

    for (const event of queue) {
      const { outcome } = await sendEvent(config, event);
      if (outcome === "sent") {
        sent += 1;
      } else if (outcome === "drop") {
        dropped += 1;
      } else {
        failed += 1;
        pending.push(event);
      }
    }

    await writeQueue(pending);
    return { sent, failed, dropped };
  });
}

export async function sendOrQueue(config: CaptureConfig, event: IngestEvent): Promise<boolean> {
  return (await sendOrQueueDetailed(config, event)).startsWith("sent");
}

/** Same as sendOrQueue, but returns a human-readable result for the capture log. */
export async function sendOrQueueDetailed(config: CaptureConfig, event: IngestEvent): Promise<string> {
  const { outcome, detail } = await sendEvent(config, event);
  if (outcome === "retry") {
    await enqueueEvent(event);
    return `queued (${detail})`;
  }
  if (outcome === "sent") {
    // The network is reachable again, so retry anything left over from earlier failures.
    void flushQueue(config).catch(() => undefined);
    return `sent (${detail})`;
  }
  return `dropped (${detail})`;
}

/**
 * - `sent`: accepted, ignored, or duplicate on the server (all 2xx).
 * - `drop`: 400/413/422; the payload itself is invalid and retrying can never succeed.
 * - `retry`: missing config, network failure, 401 (wrong secret or clock skew), 408/429/5xx.
 */
async function sendEvent(
  config: CaptureConfig,
  event: IngestEvent,
): Promise<{ outcome: "sent" | "drop" | "retry"; detail: string }> {
  if (!config.baseUrl || !config.userId || !config.secret) {
    return { outcome: "retry", detail: "missing URL, user UUID or secret" };
  }

  const payload = {
    userId: config.userId,
    event_id: event.eventId,
    channel: event.channel,
    message: event.message,
    app_or_sender: event.appOrSender,
    captured_at: event.capturedAt,
    location: event.location
      ? {
          latitude: event.location.latitude,
          longitude: event.location.longitude,
          accuracy: event.location.accuracy,
          captured_at: event.location.capturedAt,
        }
      : undefined,
  };

  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = CryptoJS.HmacSHA256(`${ts}.${body}`, config.secret).toString(CryptoJS.enc.Hex);

  try {
    const response = await fetch(`${sanitizeBaseUrl(config.baseUrl)}/api/ingest/mobile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mobile-timestamp": ts,
        "x-mobile-signature": `sha256=${signature}`,
      },
      body,
    });

    const detail = `HTTP ${response.status}`;
    if (response.ok) {
      return { outcome: "sent", detail };
    }
    return { outcome: [400, 413, 422].includes(response.status) ? "drop" : "retry", detail };
  } catch {
    return { outcome: "retry", detail: "network error" };
  }
}
