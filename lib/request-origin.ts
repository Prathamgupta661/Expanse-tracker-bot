function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function safeOrigin(input: string | null): string | null {
  if (!input) {
    return null;
  }
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

export function resolveExternalOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const originHeader = safeOrigin(firstHeaderValue(request.headers.get("origin")));
  if (originHeader) {
    return originHeader;
  }

  const host = firstHeaderValue(request.headers.get("host"));
  if (host) {
    const protocol = forwardedProto || requestUrl.protocol.replace(":", "");
    return `${protocol}://${host}`;
  }

  return requestUrl.origin;
}

