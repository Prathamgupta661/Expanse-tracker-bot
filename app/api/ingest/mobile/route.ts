import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  buildMobileFingerprint,
  buildMobileFingerprintVariants,
  getMobileDedupeWindow,
  REFERENCE_DEDUPE_WINDOW_MS,
} from "@/lib/mobile-dedupe";
import { verifyMobileIngestSignature } from "@/lib/mobile-ingest-auth";
import { formatTelegramDisplayName } from "@/lib/expense-labels";
import { getRequestId, logEvent } from "@/lib/logger";
import {
  createIngestionEvent,
  getIngestionByUpdateId,
  getProfileByUserId,
  getTelegramLinkByTelegramId,
  insertExpenses,
  listExpensesByUser,
  updateIngestionEvent,
} from "@/lib/supabase";
import { Expense, MobileExpenseLocation, MobileExpenseMeta, NewExpense } from "@/lib/types";
import { parseUpiMobileMessage } from "@/lib/upi-mobile-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface NormalizedMobilePayload {
  userId: string;
  eventId: string;
  channel: "notification" | "sms";
  message: string;
  appOrSender: string | null;
  capturedAtIso: string;
  location: MobileExpenseLocation | null;
}

/** Location is optional and best effort: anything malformed is dropped instead of rejecting the expense. */
function readLocation(value: unknown, fallbackCapturedAtIso: string): MobileExpenseLocation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const latitude = raw.latitude;
  const longitude = raw.longitude;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return null;
  }
  if (typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return null;
  }

  const accuracy = typeof raw.accuracy === "number" && Number.isFinite(raw.accuracy) && raw.accuracy >= 0
    ? raw.accuracy
    : null;
  const capturedAt = new Date(readTrimmedString(raw.captured_at) || fallbackCapturedAtIso);

  return {
    latitude,
    longitude,
    accuracy,
    captured_at: Number.isFinite(capturedAt.getTime()) ? capturedAt.toISOString() : fallbackCapturedAtIso,
  };
}

// Profile ids come from deriveUserIdFromTelegramId (hashed hex in UUID shape), so they
// carry no RFC 4122 version/variant bits; accept any 8-4-4-4-12 hex like Postgres does.
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePayload(body: unknown): { ok: true; value: NormalizedMobilePayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be a JSON object" };
  }

  const raw = body as Record<string, unknown>;
  const userId = readTrimmedString(raw.userId) || readTrimmedString(raw.user_id);
  if (!userId || !isUuid(userId)) {
    return { ok: false, error: "Invalid or missing userId" };
  }

  const eventId = readTrimmedString(raw.event_id) || readTrimmedString(raw.eventId);
  if (!eventId || eventId.length > 200) {
    return { ok: false, error: "Invalid or missing event_id" };
  }

  const channel = readTrimmedString(raw.channel);
  if (channel !== "notification" && channel !== "sms") {
    return { ok: false, error: "channel must be `notification` or `sms`" };
  }

  const message = readTrimmedString(raw.message);
  if (!message) {
    return { ok: false, error: "Missing message" };
  }

  const capturedAtInput = readTrimmedString(raw.captured_at) || readTrimmedString(raw.capturedAt);
  if (!capturedAtInput) {
    return { ok: false, error: "Missing captured_at" };
  }

  const capturedAt = new Date(capturedAtInput);
  if (!Number.isFinite(capturedAt.getTime())) {
    return { ok: false, error: "Invalid captured_at" };
  }

  const appOrSender = readTrimmedString(raw.app_or_sender) || readTrimmedString(raw.appOrSender);

  return {
    ok: true,
    value: {
      userId,
      eventId,
      channel,
      message,
      appOrSender,
      capturedAtIso: capturedAt.toISOString(),
      location: readLocation(raw.location, capturedAt.toISOString()),
    },
  };
}

// The phone often sends one payment twice at the same moment (SMS broadcast plus the messaging
// app's notification, or a re-posted notification). Running the duplicate check and the insert
// one request at a time per user stops both copies from passing the check before either inserts.
// This covers a single server process; it does not coordinate across multiple instances.
const userIngestLocks = new Map<string, Promise<unknown>>();

function withUserIngestLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = userIngestLocks.get(userId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  userIngestLocks.set(userId, tail);
  void tail.then(() => {
    if (userIngestLocks.get(userId) === tail) {
      userIngestLocks.delete(userId);
    }
  });
  return run;
}

/**
 * Same membership rule as the Telegram webhook: a member's captures belong to the owner they
 * linked to with /email, so they show on the owner's dashboard instead of an unviewable profile.
 * Also returns who sent the capture, stored like Telegram's "added by" so the dashboard can show it.
 */
async function resolveCaptureOwner(senderUserId: string): Promise<{
  ownerUserId: string;
  addedByTelegramId: number | null;
  addedByTelegramName: string | null;
}> {
  const sender = await getProfileByUserId(senderUserId);
  if (!sender?.telegram_id) {
    return { ownerUserId: senderUserId, addedByTelegramId: null, addedByTelegramName: null };
  }
  const link = await getTelegramLinkByTelegramId(sender.telegram_id);
  return {
    ownerUserId: link?.owner_user_id ?? senderUserId,
    addedByTelegramId: sender.telegram_id,
    addedByTelegramName: link
      ? formatTelegramDisplayName({
          id: sender.telegram_id,
          username: link.telegram_username,
          first_name: link.telegram_first_name,
          last_name: link.telegram_last_name,
        })
      : null,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isDuplicateViolation(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("duplicate key value") || message.includes("23505");
}

function getMobileMeta(expense: Expense): MobileExpenseMeta | null {
  const candidate = expense.mobile_meta;
  if (!candidate) {
    return null;
  }
  if (!candidate.event_id || !candidate.channel || !candidate.fingerprint || !candidate.payload_hash || !candidate.captured_at) {
    return null;
  }
  return candidate;
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  let ingestionEventId: string | null = null;

  try {
    const rawBody = await request.text();
    const authResult = verifyMobileIngestSignature({
      rawBody,
      timestampHeader: request.headers.get("x-mobile-timestamp"),
      signatureHeader: request.headers.get("x-mobile-signature"),
    });
    if (!authResult.ok) {
      logEvent({
        requestId,
        route: "/api/ingest/mobile",
        phase: "unauthorized",
        severity: "warn",
        message: "Rejected mobile ingestion request",
        details: authResult.reason,
      });
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    let body: unknown;
    try {
      body = rawBody ? (JSON.parse(rawBody) as unknown) : null;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body", requestId }, { status: 400 });
    }

    const normalized = normalizePayload(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error, requestId }, { status: 400 });
    }

    const payload = normalized.value;
    const sourceUpdateId = `mobile:${payload.userId}:${payload.eventId}`;
    // Event ids stay keyed by the sending phone's profile; the expense itself goes to the owner.
    const { ownerUserId, addedByTelegramId, addedByTelegramName } = await resolveCaptureOwner(payload.userId);

    const existing = await getIngestionByUpdateId(sourceUpdateId);
    if (existing?.status === "processed") {
      const parsedPayload =
        existing.parsed_payload && typeof existing.parsed_payload === "object"
          ? (existing.parsed_payload as Record<string, unknown>)
          : null;

      return NextResponse.json(
        {
          ok: true,
          status: "duplicate",
          reason: "event_id already processed",
          expenseId: typeof parsedPayload?.expenseId === "string" ? parsedPayload.expenseId : null,
          requestId,
        },
        { status: 200 },
      );
    }

    if (existing?.status === "received") {
      const ageMs = Date.now() - new Date(existing.created_at).getTime();
      if (Number.isFinite(ageMs) && ageMs < 30_000) {
        return NextResponse.json({ ok: true, status: "duplicate", reason: "event in-flight", requestId }, { status: 200 });
      }
    }

    try {
      const createdEvent =
        existing ||
        (await createIngestionEvent({
          userId: ownerUserId,
          rawText: payload.message,
          sourceUpdateId,
        }));
      ingestionEventId = createdEvent.id;
    } catch (error) {
      if (isDuplicateViolation(error)) {
        return NextResponse.json(
          {
            ok: true,
            status: "duplicate",
            reason: "event_id already processed",
            requestId,
          },
          { status: 200 },
        );
      }
      throw error;
    }

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const parsed = parseUpiMobileMessage({
      message: payload.message,
      appOrSender: payload.appOrSender,
    });

    if (parsed.status === "ignored") {
      await updateIngestionEvent({
        id: ingestionEventId,
        status: "processed",
        parsedPayload: {
          status: "ignored",
          reason: parsed.reason,
          eventId: payload.eventId,
          channel: payload.channel,
        },
      });
      return NextResponse.json(
        {
          ok: true,
          status: "ignored",
          reason: parsed.reason,
          requestId,
        },
        { status: 202 },
      );
    }

    const fingerprintToken = parsed.value.reference || parsed.value.merchant;
    const fingerprint = buildMobileFingerprint({
      amount: parsed.value.amount,
      merchantOrReference: fingerprintToken,
      capturedAt: payload.capturedAtIso,
    });
    const fingerprintVariants = buildMobileFingerprintVariants({
      amount: parsed.value.amount,
      merchantOrReference: fingerprintToken,
      capturedAt: payload.capturedAtIso,
    });
    const reference = parsed.value.reference;
    const window = reference
      ? getMobileDedupeWindow(payload.capturedAtIso, REFERENCE_DEDUPE_WINDOW_MS)
      : getMobileDedupeWindow(payload.capturedAtIso);

    const eventRowId = ingestionEventId;
    return await withUserIngestLock(ownerUserId, async () => {
      const candidates = await listExpensesByUser(ownerUserId, {
        from: window.from,
        to: window.to,
        limit: 200,
        offset: 0,
      });

      const duplicate = candidates.find((item) => {
        if (
          reference &&
          getMobileMeta(item) &&
          Number(item.amount) === parsed.value.amount &&
          item.note.toUpperCase().includes(reference)
        ) {
          return true;
        }
        const meta = getMobileMeta(item);
        return Boolean(meta && fingerprintVariants.includes(meta.fingerprint));
      });

      if (duplicate) {
        await updateIngestionEvent({
          id: eventRowId,
          status: "processed",
          parsedPayload: {
            status: "duplicate",
            reason: "Matched existing transaction fingerprint",
            eventId: payload.eventId,
            channel: payload.channel,
            expenseId: duplicate.id,
            fingerprint,
          },
        });

        return NextResponse.json(
          {
            ok: true,
            status: "duplicate",
            reason: "Matched existing transaction fingerprint",
            expenseId: duplicate.id,
            requestId,
          },
          { status: 200 },
        );
      }

      const mobileMeta: MobileExpenseMeta = {
        event_id: payload.eventId,
        channel: payload.channel,
        app_or_sender: payload.appOrSender,
        payload_hash: payloadHash,
        fingerprint,
        captured_at: payload.capturedAtIso,
        duplicate_of_expense_id: null,
        location: payload.location,
      };

      const expenseRows: NewExpense[] = [
        {
          user_id: ownerUserId,
          amount: parsed.value.amount,
          currency: "INR",
          category: parsed.value.category,
          merchant: parsed.value.merchant,
          note: parsed.value.note,
          expense_date: payload.capturedAtIso,
          source: "dashboard",
          category_source: "rule",
          confidence: 1,
          mobile_meta: mobileMeta,
          added_by_telegram_id: addedByTelegramId,
          added_by_telegram_name: addedByTelegramName,
        },
      ];

      const inserted = await insertExpenses(expenseRows);
      const createdExpense = inserted[0];
      if (!createdExpense) {
        throw new Error("Expense insert did not return a row");
      }

      await updateIngestionEvent({
        id: eventRowId,
        status: "processed",
        parsedPayload: {
          status: "processed",
          eventId: payload.eventId,
          channel: payload.channel,
          expenseId: createdExpense.id,
          fingerprint,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          status: "processed",
          expenseId: createdExpense.id,
          requestId,
        },
        { status: 201 },
      );
    });
  } catch (error) {
    if (ingestionEventId) {
      try {
        await updateIngestionEvent({
          id: ingestionEventId,
          status: "failed",
          error: getErrorMessage(error),
        });
      } catch {
        // Intentionally swallow secondary error while handling failure.
      }
    }

    logEvent({
      requestId,
      route: "/api/ingest/mobile",
      phase: "failed",
      severity: "error",
      message: "Mobile ingestion failed",
      details: getErrorMessage(error),
    });

    return NextResponse.json(
      {
        error: "Mobile ingestion failed",
        details: getErrorMessage(error),
        requestId,
      },
      { status: 500 },
    );
  }
}
