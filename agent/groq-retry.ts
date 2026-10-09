type ErrorFields = Record<string, unknown>;
export type GroqRateLimitKind = "daily_tokens" | "minute_tokens" | "minute_requests" | "unknown";

export type GroqErrorInfo = {
  status: number | null;
  code: string | null;
  message: string;
  retryAfterMs: number | null;
  rateLimitKind: GroqRateLimitKind;
  rateLimit: {
    requestLimit: number | null;
    requestsRemaining: number | null;
    tokenLimit: number | null;
    tokensRemaining: number | null;
    tokensUsed: number | null;
    requestsReset: string | null;
    tokensReset: string | null;
  };
};

function fields(value: unknown): ErrorFields {
  return value && typeof value === "object" ? value as ErrorFields : {};
}

function redacted(value: string): string {
  let result = value;
  const apiKey = process.env.GROQ_API_KEY;
  if (apiKey) result = result.replaceAll(apiKey, "[REDACTED]");
  return result
    .replace(/\bBearer\s+\S+/gi, "[REDACTED]")
    .replace(/\b(?:Bearer\s+)?(?:gsk_|sk-)[A-Za-z0-9_-]+/gi, "[REDACTED]")
    .replace(/\b(?:api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "[REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

function retryAfter(headers: unknown): number | null {
  if (!headers || typeof headers !== "object" || !("get" in headers) || typeof headers.get !== "function") return null;
  const value = headers.get("retry-after");
  if (value) {
    const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    if (Number.isFinite(milliseconds)) return Math.max(0, milliseconds);
  }
  const millisecondHeader = headers.get("retry-after-ms");
  if (millisecondHeader !== null && millisecondHeader !== undefined && millisecondHeader !== "") {
    const milliseconds = Number(millisecondHeader);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  }
  return null;
}

function rateLimit(headers: unknown, message: string): GroqErrorInfo["rateLimit"] {
  const headerSource = headers && typeof headers === "object" && "get" in headers && typeof headers.get === "function"
    ? headers as { get(name: string): string | null }
    : null;
  const get = (name: string) => headerSource?.get(name) ?? null;
  const count = (name: string): number | null => {
    const value = get(name);
    if (value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  const reset = (name: string): string | null => {
    const value = get(name);
    return value && /^[0-9.smhd]+$/i.test(value) ? value : null;
  };
  const requestLimit = count("x-ratelimit-limit-requests");
  const requestsRemaining = count("x-ratelimit-remaining-requests");
  const tokenLimit = count("x-ratelimit-limit-tokens");
  const tokensRemaining = count("x-ratelimit-remaining-tokens");
  const messageUsed = /\bused\s*[:=]?\s*([\d,]+)\s*tokens?\b/i.exec(message) ??
    /\btokens?\s+used\s*[:=]?\s*([\d,]+)/i.exec(message);
  const tokensUsed = count("x-ratelimit-used-tokens") ??
    (messageUsed ? Number(messageUsed[1].replaceAll(",", "")) : null) ??
    (tokenLimit !== null && tokensRemaining !== null ? Math.max(0, tokenLimit - tokensRemaining) : null);
  return {
    requestLimit, requestsRemaining, tokenLimit, tokensRemaining, tokensUsed,
    requestsReset: reset("x-ratelimit-reset-requests"),
    tokensReset: reset("x-ratelimit-reset-tokens"),
  };
}

function classifyRateLimit(code: string | null, errorType: unknown, message: string, limits: GroqErrorInfo["rateLimit"]): GroqRateLimitKind {
  const text = [code, typeof errorType === "string" ? errorType : "", message]
    .join(" ").toLocaleLowerCase("en").replace(/[_-]/g, " ");
  const dailyTokens = /\btpd\b|\btokens?\s*(?:per|\/)\s*day\b|\bdaily\s+(?:\w+\s+){0,2}tokens?\b|\btokens?\s+(?:\w+\s+){0,2}daily\b/.test(text);
  const minuteTokens = /\b(?:itpm|otpm|tpm)\b|\btokens?\s*(?:per|\/)\s*(?:minute|min)\b|\b(?:minute|minutely)\s+(?:\w+\s+){0,2}tokens?\b/.test(text);
  const minuteRequests = /\brpm\b|\brequests?\s*(?:per|\/)\s*(?:minute|min)\b|\b(?:minute|minutely)\s+(?:\w+\s+){0,2}requests?\b/.test(text);
  const dailyRequests = /\brpd\b|\brequests?\s*(?:per|\/)\s*day\b/.test(text);
  const explicit = [dailyTokens, minuteTokens, minuteRequests].filter(Boolean).length;
  if (dailyRequests || explicit > 1) return "unknown";
  if (dailyTokens) return "daily_tokens";
  if (minuteTokens) return "minute_tokens";
  if (minuteRequests) return "minute_requests";
  // Groq documents token headers as TPM and request headers as RPD. Only the
  // exhausted token header identifies a requested category by itself.
  if (limits.tokensRemaining === 0 && limits.requestsRemaining !== 0) return "minute_tokens";
  return "unknown";
}

export function rateLimitUserMessage(kind: GroqRateLimitKind): string {
  switch (kind) {
    case "daily_tokens": return "Günlük model kotası doldu. Kota yenilenmesini bekleyin veya farklı bir model seçin.";
    case "minute_tokens": return "Kısa süreli token limiti aşıldı. Biraz bekleyip tekrar deneyin.";
    case "minute_requests": return "Çok fazla istek gönderildi. Biraz bekleyip tekrar deneyin.";
    default: return "Groq rate limitine ulaşıldı. Biraz sonra tekrar deneyin veya farklı bir model seçin.";
  }
}

export function groqErrorInfo(error: unknown): GroqErrorInfo {
  const outer = fields(error);
  const payload = fields(outer.error);
  const detail = fields(payload.error);
  const status = typeof outer.status === "number" && Number.isInteger(outer.status) ? outer.status : null;
  const rawCode = detail.code ?? payload.code ?? outer.code;
  const code = typeof rawCode === "string" ? redacted(rawCode).slice(0, 100) : null;
  const rawMessage = detail.message ?? payload.message ?? outer.message;
  const message = typeof rawMessage === "string" ? redacted(rawMessage) : "Groq isteği başarısız oldu.";
  const limits = rateLimit(outer.headers, message);
  return {
    status, code, message, retryAfterMs: retryAfter(outer.headers), rateLimit: limits,
    rateLimitKind: status === 429 ? classifyRateLimit(code, detail.type ?? payload.type, message, limits) : "unknown",
  };
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Retry only the failed model request. Tool calls must stay outside this callback. */
export async function retryGroqCall<T>(call: () => Promise<T>, sleep: (milliseconds: number) => Promise<void> = wait): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await call();
    } catch (error) {
      const info = groqErrorInfo(error);
      const retryable = info.status === 429 || (info.status !== null && info.status >= 500 && info.status < 600);
      const nextRetryMs = retryable && attempt < 3 ? info.retryAfterMs ?? 1000 * 2 ** (attempt - 1) : null;
      if (process.env.NODE_ENV === "development" || info.status === 429) {
        console.error("[PetOps Groq]", {
          attempt, status: info.status, code: info.code, message: info.message,
          ...(info.status === 429 ? { rateLimitKind: info.rateLimitKind, ...info.rateLimit, retryAfterMs: info.retryAfterMs, nextRetryMs } : {}),
        });
      }
      if (!retryable || attempt === 3) throw error;
      await sleep(nextRetryMs!);
    }
  }
  throw new Error("Groq retry sınırına ulaşıldı.");
}
