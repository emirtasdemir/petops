import assert from "node:assert/strict";
import test from "node:test";
import { groqErrorInfo, rateLimitUserMessage, retryGroqCall } from "../agent/groq-retry.ts";

function apiError(status, retryAfter, code = "test_error") {
  return {
    status,
    headers: new Headers(retryAfter === undefined ? {} : { "Retry-After": retryAfter }),
    error: { error: { code, message: "Simulated Groq failure" } },
    message: `${status} Simulated Groq failure`,
  };
}

test("429 retries only the request, at 1s and 2s, with three total attempts", async () => {
  let calls = 0;
  const delays = [];
  const result = await retryGroqCall(async () => {
    calls++;
    if (calls < 3) throw apiError(429);
    return "ok";
  }, async (milliseconds) => { delays.push(milliseconds); });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("Retry-After takes priority for 5xx and errors retain status/code/message", async () => {
  let calls = 0;
  const delays = [];
  const failure = apiError(503, "3", "server_busy");
  const info = groqErrorInfo(failure);
  assert.deepEqual({ status: info.status, code: info.code, message: info.message }, {
    status: 503, code: "server_busy", message: "Simulated Groq failure",
  });
  await retryGroqCall(async () => {
    calls++;
    if (calls === 1) throw failure;
    return "ok";
  }, async (milliseconds) => { delays.push(milliseconds); });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [3000]);
});

test("401, 403, validation and schema errors are not retried", async () => {
  for (const status of [400, 401, 403, 422]) {
    let calls = 0;
    await assert.rejects(retryGroqCall(async () => {
      calls++;
      throw apiError(status);
    }, async () => { throw new Error("Unexpected sleep"); }));
    assert.equal(calls, 1);
  }
});

test("5xx stops after three total attempts", async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(retryGroqCall(async () => {
    calls++;
    throw apiError(500);
  }, async (milliseconds) => { delays.push(milliseconds); }));
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("a successful tool is not repeated when the following model request retries", async () => {
  let modelCalls = 0;
  let toolRuns = 0;
  for (let turn = 0; turn < 2; turn++) {
    const response = await retryGroqCall(async () => {
      modelCalls++;
      if (modelCalls === 2) throw apiError(429);
      return modelCalls === 1 ? "tool_call" : "answer";
    }, async () => {});
    if (response === "tool_call") toolRuns++;
  }
  assert.equal(modelCalls, 3);
  assert.equal(toolRuns, 1);
});

test("diagnostics redact API keys and bearer tokens", () => {
  const previous = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "example-test-value";
  try {
    const info = groqErrorInfo({ status: 400, error: { message: "Bearer example-test-value invalid" } });
    assert.equal(info.message.includes("example-test-value"), false);
  } finally {
    if (previous === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previous;
  }
});

test("development logs only sanitized status, code and message", async () => {
  const previousMode = process.env.NODE_ENV;
  const previousKey = process.env.GROQ_API_KEY;
  const originalError = console.error;
  const entries = [];
  process.env.NODE_ENV = "development";
  process.env.GROQ_API_KEY = "example-test-value";
  console.error = (...args) => { entries.push(args); };
  try {
    await assert.rejects(retryGroqCall(async () => {
      throw { status: 400, error: { error: { code: "invalid_schema", message: "Bearer example-test-value is invalid" } } };
    }, async () => { throw new Error("Unexpected sleep"); }));
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], "[PetOps Groq]");
    assert.deepEqual(entries[0][1], {
      attempt: 1, status: 400, code: "invalid_schema", message: "[REDACTED] is invalid",
    });
  } finally {
    console.error = originalError;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});

test("429 diagnostics include Groq limits, used tokens and retry duration", async () => {
  const previousMode = process.env.NODE_ENV;
  const originalError = console.error;
  const entries = [];
  process.env.NODE_ENV = "development";
  console.error = (...args) => { entries.push(args); };
  try {
    const headers = new Headers({
      "Retry-After": "2",
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-remaining-requests": "0",
      "x-ratelimit-limit-tokens": "8000",
      "x-ratelimit-remaining-tokens": "1500",
      "x-ratelimit-reset-requests": "2m59.56s",
      "x-ratelimit-reset-tokens": "7.66s",
    });
    let calls = 0;
    const delays = [];
    await retryGroqCall(async () => {
      calls++;
      if (calls === 1) throw { status: 429, headers, error: { error: { code: "rate_limit_exceeded", message: "Rate limit reached" } } };
      return "ok";
    }, async (milliseconds) => { delays.push(milliseconds); });
    assert.equal(calls, 2);
    assert.deepEqual(delays, [2000]);
    assert.deepEqual(entries[0][1], {
      attempt: 1, status: 429, code: "rate_limit_exceeded", message: "Rate limit reached",
      rateLimitKind: "unknown",
      requestLimit: 1000, requestsRemaining: 0,
      tokenLimit: 8000, tokensRemaining: 1500, tokensUsed: 6500,
      requestsReset: "2m59.56s", tokensReset: "7.66s", retryAfterMs: 2000, nextRetryMs: 2000,
    });
  } finally {
    console.error = originalError;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});

test("429 limit kinds use explicit evidence and keep ambiguous cases generic", () => {
  const cases = [
    [{ message: "Tokens per day (TPD) limit reached" }, "daily_tokens"],
    [{ code: "tokens_per_day_exceeded", message: "Rate limit reached" }, "daily_tokens"],
    [{ message: "Tokens per minute (TPM) limit reached" }, "minute_tokens"],
    [{ message: "Input tokens per minute (ITPM) limit reached" }, "minute_tokens"],
    [{ message: "Requests per minute (RPM) limit reached" }, "minute_requests"],
    [{ message: "Requests per day (RPD) limit reached" }, "unknown"],
    [{ message: "Rate limit reached", headers: { "x-ratelimit-remaining-tokens": "0", "x-ratelimit-remaining-requests": "10" } }, "minute_tokens"],
    [{ message: "Rate limit reached", headers: { "x-ratelimit-remaining-requests": "0" } }, "unknown"],
    [{ message: "Rate limit reached", headers: { "x-ratelimit-remaining-tokens": "0", "x-ratelimit-remaining-requests": "0" } }, "unknown"],
    [{ message: "TPM and RPM limits reached" }, "unknown"],
    [{ message: "Rate limit reached" }, "unknown"],
  ];
  for (const [sample, expected] of cases) {
    const error = {
      status: 429,
      headers: new Headers(sample.headers || {}),
      error: { error: { code: sample.code || "rate_limit_exceeded", message: sample.message } },
    };
    assert.equal(groqErrorInfo(error).rateLimitKind, expected, sample.message);
  }
});

test("user messages match the identified 429 limit kind", () => {
  assert.equal(rateLimitUserMessage("daily_tokens"), "Günlük model kotası doldu. Kota yenilenmesini bekleyin veya farklı bir model seçin.");
  assert.equal(rateLimitUserMessage("minute_tokens"), "Kısa süreli token limiti aşıldı. Biraz bekleyip tekrar deneyin.");
  assert.equal(rateLimitUserMessage("minute_requests"), "Çok fazla istek gönderildi. Biraz bekleyip tekrar deneyin.");
  assert.equal(rateLimitUserMessage("unknown"), "Groq rate limitine ulaşıldı. Biraz sonra tekrar deneyin veya farklı bir model seçin.");
});
