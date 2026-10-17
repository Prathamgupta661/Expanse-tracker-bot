import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "@/lib/config";

const SIGNATURE_PREFIX = "sha256=";

function normalizeHexSignature(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = trimmed.startsWith(SIGNATURE_PREFIX)
    ? trimmed.slice(SIGNATURE_PREFIX.length)
    : trimmed;

  if (!/^[a-f0-9]{64}$/i.test(normalized)) {
    return null;
  }

  return normalized.toLowerCase();
}

function computeSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function verifyMobileIngestSignature(params: {
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const timestampRaw = params.timestampHeader?.trim();
  if (!timestampRaw) {
    return { ok: false, reason: "Missing X-Mobile-Timestamp header" };
  }

  const timestampSeconds = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    return { ok: false, reason: "Invalid timestamp header" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > config.mobileIngestMaxSkewSeconds) {
    return { ok: false, reason: "Timestamp outside allowed skew window" };
  }

  const providedSignature = normalizeHexSignature(params.signatureHeader);
  if (!providedSignature) {
    return { ok: false, reason: "Missing or malformed X-Mobile-Signature header" };
  }

  const expectedSignature = computeSignature(config.getMobileIngestSecret(), timestampRaw, params.rawBody);
  const providedBuffer = Buffer.from(providedSignature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false, reason: "Invalid signature" };
  }

  return { ok: true };
}
