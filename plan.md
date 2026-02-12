# Plan: Per-User Rate Limiting

## Goal

Implement per-user daily rate limiting (PRD sections 1 & 4) so that no single user can generate runaway API costs. This covers:
- Per-user daily **request caps** (configurable, default 50 messages/day)
- Per-user daily **token budget** (configurable)
- **Token usage tracking** per user in DynamoDB
- Clear, friendly **error messages** when limits are hit
- `max_tokens` set on **all** provider calls (OpenAI and Perplexity currently missing it)
- **CloudWatch alarms** for spend monitoring

---

## Design Decisions

### Rate limit storage: Same DynamoDB table (single-table design)

Store rate limit counters as new item types in the existing `chats` table rather than creating a separate table. This avoids new IAM policies, new table provisioning, and keeps the single-table pattern consistent. The items will use TTL for automatic cleanup.

**DynamoDB item schema:**

```
PK: RATELIMIT#<internalUserId>
SK: DAILY#<YYYY-MM-DD>
```

Attributes:
- `requestCount` (Number) — incremented atomically per LLM API call
- `tokenCount` (Number) — incremented atomically after each response
- `ttl` (Number) — epoch seconds, set to midnight + 48h for auto-cleanup
- `updatedAt` (String) — ISO timestamp of last update

### Counting strategy: Requests gated before call, tokens tracked after

1. **Before** calling the LLM API: atomic `UpdateItem` with `ADD requestCount 1`, with a `ConditionExpression` that rejects if `requestCount >= MAX_DAILY_REQUESTS`. This is a single DynamoDB operation that both checks and increments atomically — no race conditions.
2. **After** the LLM response completes: `UpdateItem` with `ADD tokenCount <usage>` to track cumulative token spend. Token counts are best-effort (some providers don't report usage in streaming mode), so token budget enforcement is a soft limit checked before the next request, not a hard mid-stream cutoff.

### What counts as a "request"

Each `sendMessage`, `judgeResponse`, and `judgeFollowUp` mutation counts as 1 request against the daily cap. These are the three Lambda handlers that call external LLM APIs. CRUD operations (createChat, listChats, deleteChat, saveMessage, etc.) do not count — they're low-cost DynamoDB operations.

### Token counting approach

- **Anthropic**: Reports `usage.input_tokens` and `usage.output_tokens` in the `message_stop` event during streaming. Parse and record.
- **OpenAI**: Reports `usage` in the final streaming chunk (when `stream_options.include_usage: true` is set). Add this option and parse.
- **Gemini**: Reports `usageMetadata` in streaming responses. Parse and record.
- **Perplexity**: OpenAI-compatible API; same approach as OpenAI.
- **Grok**: OpenAI-compatible API; same approach as OpenAI.
- **Judge calls** (non-streaming): All providers return usage in the response body. Parse and record.
- **Fallback**: If token count is unavailable from a provider response, estimate based on character count (÷4 as rough approximation).

### Configuration: Environment variables on Lambda

Rate limit thresholds are passed as Lambda environment variables (set via Terraform variables). This allows changing limits without code deploys.

- `RATE_LIMIT_DAILY_REQUESTS` (default: `50`)
- `RATE_LIMIT_DAILY_TOKENS` (default: `500000`)

### Frontend error handling

Rate limit errors return a specific error code/message pattern (`RATE_LIMIT_EXCEEDED`) that the frontend can detect and display a user-friendly message: *"You've reached today's limit. Come back tomorrow!"*

---

## Implementation Steps

### Step 1: Add `max_tokens` to OpenAI and Perplexity providers

**Files:**
- `infrastructure/lambda/src/providers/openai.ts`
- `infrastructure/lambda/src/providers/perplexity.ts`
- `infrastructure/lambda/src/providers/grok.ts`

**Changes:**
- Add `max_tokens: 4096` to the `streamOpenAI()` request body (line 26-30)
- Add `max_tokens: 4096` to the `judgeOpenAI()` request body (line 120-127)
- Add `max_tokens: 4096` to the `streamPerplexity()` request body (line 93-97)
- Add `max_tokens: 4096` to the `judgePerplexity()` request body (line 205-211)
- Add `max_tokens: 4096` to `streamGrok()` and `judgeGrok()` similarly

This is the simplest safety measure and should be done first regardless of the rest.

### Step 2: Enable DynamoDB TTL on the chats table

**Files:**
- `infrastructure/dynamodb.tf`

**Changes:**
- Add a `ttl` attribute configuration to the `aws_dynamodb_table.chats` resource:
  ```hcl
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
  ```
- This enables automatic expiration of rate limit counter items. Existing items without a `ttl` attribute are unaffected.

### Step 3: Add `UpdateItem` permission to Lambda IAM policy

**Files:**
- `infrastructure/iam.tf`

**Changes:**
- Add `dynamodb:UpdateItem` to the `lambda_dynamodb_access` policy's Action list (line 153-158). Currently missing and needed for atomic counter increments.

### Step 4: Add Terraform variables for rate limit configuration

**Files:**
- `infrastructure/variables.tf`
- `infrastructure/lambda.tf`

**Changes in `variables.tf`:**
- Add `rate_limit_daily_requests` variable (type: number, default: 50)
- Add `rate_limit_daily_tokens` variable (type: number, default: 500000)

**Changes in `lambda.tf`:**
- Add `RATE_LIMIT_DAILY_REQUESTS` and `RATE_LIMIT_DAILY_TOKENS` to the environment variables of the chat Lambda (line 38-42), judge Lambda (line 69-72), and judge_follow_up Lambda (line 117-120).

### Step 5: Create the rate limiting service module

**Files:**
- `infrastructure/lambda/src/rateLimiter.ts` (new file)

**Contents:**
- `checkAndIncrementRequestCount(internalUserId: string): Promise<void>` — Performs a single DynamoDB `UpdateItem` with:
  - `SET` to initialize `requestCount` to 0 and `ttl` if the item doesn't exist (using `if_not_exists`)
  - `ADD requestCount :one` to atomically increment
  - `ConditionExpression`: `attribute_not_exists(requestCount) OR requestCount < :maxRequests`
  - On `ConditionalCheckFailedException`: throw a `RateLimitError` with a user-friendly message
- `checkTokenBudget(internalUserId: string): Promise<void>` — Reads the current day's token count and throws `RateLimitError` if over budget. This is a soft check (read-then-decide), acceptable because token tracking is best-effort.
- `recordTokenUsage(internalUserId: string, tokenCount: number): Promise<void>` — `UpdateItem` with `ADD tokenCount :tokens` to accumulate usage. Callers must wrap this in try/catch and log failures silently, since token recording happens after the response has already been returned to the user.
- `RateLimitError` class extending `Error` with a `code: 'RATE_LIMIT_EXCEEDED'` property.
- Helper: `getTodayKey(): string` — Returns `YYYY-MM-DD` in UTC for the sort key.
- Helper: `getTtlEpoch(): number` — Returns epoch seconds for midnight UTC + 48 hours.
- Constants read from `process.env.RATE_LIMIT_DAILY_REQUESTS` and `process.env.RATE_LIMIT_DAILY_TOKENS` with sensible defaults.

### Step 6: Integrate rate limiting into Lambda handlers

**Files:**
- `infrastructure/lambda/src/chat.ts`
- `infrastructure/lambda/src/judge.ts`
- `infrastructure/lambda/src/judgeFollowUp.ts`

**Changes in `chat.ts`:**
- After `resolveInternalUserId()` resolves (line 52-54), call `checkTokenBudget(internalUserId)` first (read-only, won't mutate state if the next check fails), then `checkAndIncrementRequestCount(internalUserId)` (atomic write). This ordering ensures a token-budget rejection doesn't burn a request slot.
- If `RateLimitError` is thrown, return `{ status: 'ERROR', message: error.message }` with the friendly message — same pattern as existing `ValidationError` handling.
- After streaming completes in `streamInBackground()`, call `recordTokenUsage(internalUserId, tokenCount)` with the token count returned from the provider. Wrap in try/catch — log failures with `console.error` but do not propagate, since `callback()` has already returned and the user cannot see these errors.

**Changes in `judge.ts`:**
- After `resolveInternalUserId()` (line 123), call `checkTokenBudget(internalUserId)` first, then `checkAndIncrementRequestCount(internalUserId)` (same ordering rationale as chat.ts).
- Catch `RateLimitError` and return `{ score: 0, explanation: error.message, problems: ['Rate limit exceeded'] }`.
- After the judge call completes, call `recordTokenUsage()` with parsed token counts. Wrap in try/catch — log failures but do not propagate.

**Changes in `judgeFollowUp.ts`:**
- Same pattern as `judge.ts`: check token budget then increment request count before calling, record after (with silent failure handling).

### Step 7: Extract token usage from provider responses

**Files:**
- `infrastructure/lambda/src/providers/openai.ts`
- `infrastructure/lambda/src/providers/anthropic.ts`
- `infrastructure/lambda/src/providers/gemini.ts`
- `infrastructure/lambda/src/providers/perplexity.ts`
- `infrastructure/lambda/src/providers/grok.ts`

**Changes:**
- Modify all `stream*()` functions to return `Promise<{ tokenCount: number }>` instead of `Promise<void>`, reporting how many tokens were used.
- Modify all `judge*()` functions similarly.
- **OpenAI/Perplexity/Grok (streaming):** Add `stream_options: { include_usage: true }` to the request body. Parse the `usage` field from the final chunk (`usage.total_tokens`).
- **Anthropic (streaming):** Parse `usage.input_tokens` + `usage.output_tokens` from the `message_stop` or `message_delta` event.
- **Gemini (streaming):** Parse `usageMetadata.totalTokenCount` from the response chunks.
- **All judge functions (non-streaming):** Parse the `usage` field from the response JSON body.
- If parsing fails or the field is missing, estimate: `Math.ceil(responseText.length / 4)`.

### Step 8: Update `streamInBackground` to pass token usage back

**Files:**
- `infrastructure/lambda/src/chat.ts`

**Changes:**
- `streamInBackground()` currently returns `Promise<void>`. Change to return `Promise<number>` (token count).
- After the stream function returns, call `recordTokenUsage(internalUserId, tokenCount)`.
- The `internalUserId` needs to be threaded into `streamInBackground()` — currently only `externalUserId` is passed (for subscription routing). Add `internalUserId` as an additional parameter.

### Step 9: Surface rate limit errors on the frontend

**Files:**
- `src/App.tsx` (or wherever error messages from `sendMessage` are displayed)

**Changes:**
- Detect when an error message contains `RATE_LIMIT_EXCEEDED` or a specific pattern like "reached today's limit".
- Display a distinct, friendly UI treatment: an info-level banner or toast rather than a generic error, with the message *"You've reached today's limit. Come back tomorrow!"*
- No need for a new GraphQL type or schema change — the existing `SendMessageResponse.message` and error chunk mechanism already carry the message text.

### Step 10: Add CloudWatch alarms for spend monitoring

**Files:**
- `infrastructure/cloudwatch.tf` (new file)

**Changes:**
- Add a CloudWatch metric filter on the chat/judge Lambda log groups that extracts token usage from structured log lines.
- Add CloudWatch alarms:
  - **High invocation count alarm**: Triggers when total Lambda invocations across chat+judge functions exceed a threshold (e.g., 1000/hour).
  - **Per-user abuse detection**: A custom metric published from the rate limiter when a user hits their limit — alarm if the same user hits limits repeatedly.
- Add an SNS topic for alarm notifications (email-based, operator configurable).
- Add Terraform variables for alarm thresholds and notification email.

---

## Files Modified (Summary)

| File | Change Type |
|------|-------------|
| `infrastructure/lambda/src/providers/openai.ts` | Add `max_tokens`, return token count |
| `infrastructure/lambda/src/providers/perplexity.ts` | Add `max_tokens`, return token count |
| `infrastructure/lambda/src/providers/grok.ts` | Add `max_tokens`, return token count |
| `infrastructure/lambda/src/providers/anthropic.ts` | Return token count |
| `infrastructure/lambda/src/providers/gemini.ts` | Return token count |
| `infrastructure/lambda/src/rateLimiter.ts` | **New** — rate limiting service |
| `infrastructure/lambda/src/chat.ts` | Integrate rate limiter |
| `infrastructure/lambda/src/judge.ts` | Integrate rate limiter |
| `infrastructure/lambda/src/judgeFollowUp.ts` | Integrate rate limiter |
| `infrastructure/dynamodb.tf` | Enable TTL |
| `infrastructure/iam.tf` | Add `UpdateItem` permission |
| `infrastructure/variables.tf` | Add rate limit variables |
| `infrastructure/lambda.tf` | Pass rate limit env vars |
| `infrastructure/cloudwatch.tf` | **New** — alarms and metrics |
| `src/App.tsx` | Display rate limit errors |

## Out of Scope

- Admin dashboard (PRD section 25 / P3) — deferred; CloudWatch alarms provide initial visibility.
- Per-provider rate limits — all providers share a single daily cap per user. Can be split later if needed.
- Real-time usage display to users (e.g., "You have 12 messages remaining today") — a good enhancement but not required by the PRD for the initial implementation.
