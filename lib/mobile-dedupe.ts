import { createHash } from "node:crypto";

const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

function normalizeToken(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return normalized || "unknown";
}

function toCapturedTimeMs(capturedAt: Date | string): number {
  const value = capturedAt instanceof Date ? capturedAt.getTime() : new Date(capturedAt).getTime();
  if (!Number.isFinite(value)) {
    throw new Error("Invalid captured_at timestamp");
  }
  return value;
}

function hashFingerprint(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function buildFingerprintPayload(params: {
  amount: number;
  merchantOrReference: string;
  capturedAtMs: number;
  bucketOffset: number;
}): string {
  const bucket = Math.floor(params.capturedAtMs / DEDUPE_WINDOW_MS) + params.bucketOffset;
  const token = normalizeToken(params.merchantOrReference);
  return `${params.amount.toFixed(2)}|${token}|${bucket}`;
}

export function buildMobileFingerprint(params: {
  amount: number;
  merchantOrReference: string;
  capturedAt: Date | string;
  bucketOffset?: number;
}): string {
  const capturedAtMs = toCapturedTimeMs(params.capturedAt);
  const payload = buildFingerprintPayload({
    amount: params.amount,
    merchantOrReference: params.merchantOrReference,
    capturedAtMs,
    bucketOffset: params.bucketOffset || 0,
  });
  return hashFingerprint(payload);
}

export function buildMobileFingerprintVariants(params: {
  amount: number;
  merchantOrReference: string;
  capturedAt: Date | string;
}): string[] {
  const capturedAtMs = toCapturedTimeMs(params.capturedAt);
  const offsets = [-1, 0, 1];
  return offsets.map((offset) =>
    hashFingerprint(
      buildFingerprintPayload({
        amount: params.amount,
        merchantOrReference: params.merchantOrReference,
        capturedAtMs,
        bucketOffset: offset,
      }),
    ),
  );
}

export function getMobileDedupeWindow(capturedAt: Date | string): { from: string; to: string } {
  const capturedAtMs = toCapturedTimeMs(capturedAt);
  return {
    from: new Date(capturedAtMs - DEDUPE_WINDOW_MS).toISOString(),
    to: new Date(capturedAtMs + DEDUPE_WINDOW_MS).toISOString(),
  };
}
