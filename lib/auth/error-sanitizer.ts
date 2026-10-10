export interface SanitizedErrorInfo {
  errorKey: string;
  sanitizedMessage: string;
  errorName: string;
  status: number | string;
  timestamp: string;
  urlTruncatedStatus?: string | null;
}

export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "";
  let clean = msg;
  // Redact emails
  clean = clean.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "***@***");
  // Redact bearer tokens or jwt
  clean = clean.replace(/(bearer\s+|token=)[a-zA-Z0-9._-]+/gi, "$1***");
  // Redact anon keys or apikeys
  clean = clean.replace(/(key=|apikey=)[a-zA-Z0-9._-]+/gi, "$1***");
  // Redact url query params
  clean = clean.replace(/(\?|&)[a-zA-Z0-9_]+=[^&\s]+/g, "$1***=***");
  return clean;
}

export function mapSupabaseError(error: any, urlTruncatedReason?: string | null): SanitizedErrorInfo {
  const timestamp = new Date().toISOString();
  const status = error?.status || error?.statusCode || (error?.name === "FetchError" ? "NetworkError" : "Unknown");
  const rawMessage = error?.message || String(error || "");
  const errorName = error?.name || error?.code || "AuthError";

  const lowerMsg = rawMessage.toLowerCase();
  let errorKey = "genericError";

  if (
    status === 429 ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("over_email_send_rate_limit") ||
    lowerMsg.includes("too many requests")
  ) {
    errorKey = "rateLimitExceeded";
  } else if (
    status === 0 ||
    errorName === "FetchError" ||
    lowerMsg.includes("fetch failed") ||
    lowerMsg.includes("failed to fetch") ||
    lowerMsg.includes("network")
  ) {
    errorKey = "networkError";
  } else if (
    lowerMsg.includes("invalid") ||
    lowerMsg.includes("expired") ||
    lowerMsg.includes("otp") ||
    lowerMsg.includes("token") ||
    lowerMsg.includes("code") ||
    status === 400 ||
    status === 422
  ) {
    errorKey = "invalidOrExpiredCode";
  } else if (typeof status === "number" && status >= 500) {
    errorKey = "authUnavailable";
  }

  return {
    errorKey,
    sanitizedMessage: sanitizeErrorMessage(rawMessage),
    errorName: String(errorName),
    status,
    timestamp,
    urlTruncatedStatus: urlTruncatedReason || null,
  };
}
