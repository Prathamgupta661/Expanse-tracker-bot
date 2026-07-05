import { randomUUID } from "node:crypto";

type LogSeverity = "info" | "warn" | "error";

interface LogPayload {
  requestId: string;
  route: string;
  phase: string;
  severity: LogSeverity;
  message: string;
  details?: unknown;
}

export function getRequestId(request: Request): string {
  return request.headers.get("x-request-id") || randomUUID();
}

export function logEvent(payload: LogPayload): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  });

  if (payload.severity === "error") {
    console.error(line);
    return;
  }
  if (payload.severity === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
