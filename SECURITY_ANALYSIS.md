# Security Analysis Report

**Date:** 2026-03-01
**Previous review:** 2026-02-13
**Scope:** Full-stack review -- React/TypeScript frontend, AWS Lambda backend, Terraform infrastructure, GraphQL schema, VTL resolvers
**Overall risk level: MEDIUM** -- No critical vulnerabilities. Multiple high and medium findings require attention before opening to testers.

---

## Changes Since Last Review (2026-02-13)

### Previously Fixed (Confirmed Still Fixed)
- Subscription eavesdropping -- `userId` filter on subscription
- `createChat` overwrite -- `TransactWriteCommand` with `attribute_not_exists(PK)`
- Input validation in Lambdas -- comprehensive validation in `validation.ts`
- Prompt injection in judge -- XML tags with `escapeXmlContent()`
- Dead client-side API key code -- removed
- Model allowlist -- enforced in validation
- `userService` race condition -- fixed with conditional writes
- Rate limiting -- fully implemented per-user daily request and token limits

### New Features Reviewed
- Grok provider -- follows same security patterns as other providers
- Judge follow-up handler -- has validation, rate limiting, XML escaping
- Image generation -- OpenAI image provider with S3 presigned URLs
- Web search context -- Perplexity integration for judge fact-checking

### Findings Status
- 4 findings from the prior review are now confirmed fixed
- 12 findings from the prior review remain open
- 9 new findings identified in this review
- **Total: 37 findings** (3 High, 12 Medium, 14 Low, 8 Informational)

---

## High Severity

### H1. Weak ID Generation for chatId and messageId

**Files:** `src/utils/dummyResponses.ts:13-15`, `src/App.tsx:165,566,572`
**Status:** Open (carried from prior review)

```typescript
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
```

`Math.random()` is not cryptographically secure. Combined with `Date.now()`, IDs are predictable to an attacker who knows approximately when a chat was created. While `createChat` prevents overwrites, predictable IDs reduce defense-in-depth.

**Recommendation:** Replace all uses of `generateId()` with `crypto.randomUUID()`.

---

### H2. Local Terraform State File

**File:** `infrastructure/main.tf:15-21`
**Status:** Open (carried from prior review)

Terraform state is stored locally with the S3 backend commented out. The state contains Secrets Manager ARNs, IAM role ARNs, and full AppSync configuration. No encryption, versioning, backup, or state locking.

**Recommendation:** Enable the S3 backend with encryption and DynamoDB state locking.

---

### H3. Gemini API Key Passed in URL Query String

**Files:** `infrastructure/lambda/src/providers/gemini.ts:62,194`, `infrastructure/lambda/src/providers/geminiImage.ts:36`
**Status:** Open (carried from prior review)

```typescript
const url = `${GEMINI_API_BASE}/${modelName}:streamGenerateContent?key=${apiKey}&alt=sse`;
```

The API key appears in URLs, which risks exposure through CloudWatch logs, proxy logs, and error stack traces. All other providers pass keys via the `Authorization` header.

**Recommendation:** Use the `x-goog-api-key` header instead, or migrate to the official `@google/generative-ai` SDK.

---

## Medium Severity

### M1. No Content Security Policy or Security Headers

**Files:** `index.html`, `scripts/deploy.sh`
**Status:** Open (carried from prior review)

No CSP, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` headers. External Google Fonts loaded without Subresource Integrity hashes.

**Recommendation:** Add a CSP meta tag to `index.html`:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com;
  connect-src 'self' https://*.appsync-api.*.amazonaws.com
    wss://*.appsync-realtime-api.*.amazonaws.com https://*.clerk.accounts.dev;
  img-src 'self' data: https:;
  frame-src https://*.clerk.accounts.dev;">
```

Configure a CloudFront response headers policy in Terraform for HSTS, X-Frame-Options, and X-Content-Type-Options.

---

### M2. OIDC Configuration Missing Client ID Validation

**File:** `infrastructure/appsync.tf:6-8`
**Status:** NEW

The AppSync OIDC config specifies the `issuer` but not the `client_id`. Any valid JWT from the same Clerk instance (including tokens for other Clerk applications) would be accepted. The `clerk_client_id` variable exists in `variables.tf` but is unused.

```terraform
openid_connect_config {
  issuer = var.clerk_issuer_url
  # Missing: client_id = var.clerk_client_id
}
```

**Recommendation:** Add `client_id = var.clerk_client_id`.

---

### M3. Overly Broad AppSync GraphQL IAM Policy on Lambda Role

**File:** `infrastructure/iam.tf:44-61`
**Status:** Open (carried from prior review)

```hcl
Resource = "${aws_appsync_graphql_api.chatbot.arn}/*"
```

The wildcard grants permission to call any GraphQL operation, not just `publishChunk`. A compromised Lambda could execute any mutation or query.

**Recommendation:** Scope to specific fields: `"${arn}/types/Mutation/fields/publishChunk"`.

---

### M4. Shared Lambda Execution Role Across All Functions

**File:** `infrastructure/iam.tf:1-17`, `infrastructure/lambda.tf`
**Status:** NEW

All 9 Lambda functions share a single IAM role. Functions like `delete_chat` and `list_chats` (which only need DynamoDB) also get Secrets Manager, AppSync, and S3 permissions.

**Recommendation:** Create per-function or per-group IAM roles with only required permissions.

---

### M5. Subscription Eavesdropping -- Ownership Not Enforced Server-Side

**File:** `infrastructure/schema.graphql:267-273`
**Status:** Partially fixed (filter exists but not enforced against identity)

The `onMessageChunk` subscription filters by client-supplied `userId`, but AppSync does not automatically verify that the subscribing user's OIDC `sub` matches the `userId` argument. A malicious authenticated user could subscribe with another user's `userId` and a guessed `requestId`.

**Recommendation:** Add a VTL request resolver on the subscription:

```vtl
#if($context.identity.sub != $context.args.userId)
  $util.unauthorized()
#end
{ "version": "2018-05-29", "payload": {} }
```

---

### M6. No WAF Protection on AppSync API

**File:** `infrastructure/appsync.tf`
**Status:** Open (carried from prior review)

No AWS WAF Web ACL on the AppSync endpoint. The Lambda rate limiter only applies after authentication and invocation, so unauthenticated abuse can consume resources and incur costs.

**Recommendation:** Add an `aws_wafv2_web_acl` with rate-based rules and managed rule groups.

---

### M7. Error Messages Leak Provider API Details

**Files:** `infrastructure/lambda/src/providers/openai.ts:37`, `anthropic.ts:69`, `gemini.ts:73`, `grok.ts:37`, `judge.ts:225,262`, `chat.ts:99`
**Status:** Open (carried from prior review)

Raw LLM API error responses propagate to users. These may contain rate limit details, account identifiers, internal endpoints, or API key fragments.

```typescript
throw new Error(`OpenAI API error: ${response.status} ${error}`);
```

**Recommendation:** Log full errors server-side; return generic messages to users.

---

### M8. Pagination Token Injection in listChats

**File:** `infrastructure/lambda/src/listChats.ts:55`
**Status:** Open (carried from prior review)

The `nextToken` is base64-decoded and parsed as JSON, then passed directly as DynamoDB's `ExclusiveStartKey` without validation. A crafted token could point to arbitrary key structures.

**Recommendation:** Validate the decoded token matches the user's partition, or use server-side opaque pagination.

---

### M9. DynamoDB Table Lacks KMS Encryption and Point-in-Time Recovery

**File:** `infrastructure/dynamodb.tf:1-28`
**Status:** Open (carried from prior review)

No explicit `server_side_encryption` with customer-managed KMS key. No `point_in_time_recovery` enabled. The table stores user conversations, user ID mappings, and rate limit records.

**Recommendation:** Enable both KMS encryption and PITR.

---

### M10. Secrets Manager Has No Rotation Policy

**File:** `infrastructure/secrets.tf:1-25`
**Status:** NEW

No rotation rules configured. API keys that are never rotated increase blast radius if compromised.

**Recommendation:** At minimum, tag secrets with review dates and set up age-based CloudWatch alarms.

---

### M11. Stale `VITE_OPENAI_API_KEY` in Frontend Type Declarations

**File:** `src/vite-env.d.ts:4`
**Status:** NEW

The `ImportMetaEnv` interface declares `VITE_OPENAI_API_KEY`. While unused, a developer seeing this declaration might add the key to `.env`, where Vite would bake it into the browser JavaScript bundle.

**Recommendation:** Remove `VITE_OPENAI_API_KEY` and `VITE_OPENAI_MODEL` from the interface.

---

### M12. Race Condition in Token Budget Rate Limiting

**File:** `infrastructure/lambda/src/rateLimiter.ts:35-55`
**Status:** NEW

`checkTokenBudget()` is a read-only check. Between this check and `recordTokenUsage` (called after the LLM response), concurrent requests can all pass the budget check.

**Recommendation:** Add a conditional update in `recordTokenUsage` that enforces a hard cap.

---

## Low Severity

### L1. Unsanitized Image URLs and Download Links

**Files:** `src/components/ImageCard.tsx:13-22,53`, `src/components/ImageLightbox.tsx:28-37,133`

Image URLs rendered in `<img src>` without URL validation. Download function uses `target='_blank'` without `rel="noopener noreferrer"`.

**Recommendation:** Validate URL schemes (allow only `https:` and `data:image/`); add `rel="noopener noreferrer"`.

---

### L2. KaTeX XSS Surface in Markdown Rendering

**Files:** `src/components/ChatMessage.tsx:285-317`, `src/components/ResponseQualityRating.tsx:234`

`rehype-katex` has had historical XSS vulnerabilities. While `react-markdown` is safe by default (no raw HTML), KaTeX processing could introduce injection.

**Recommendation:** Keep `rehype-katex`/`katex` updated. Consider adding `rehype-sanitize`.

---

### L3. `chatId` Not Validated for Format

**Files:** `infrastructure/lambda/src/createChat.ts:40-41`, `infrastructure/lambda/src/deleteChat.ts:29`

User-supplied `chatId` used directly in DynamoDB key construction without format validation.

**Recommendation:** Validate format: `/^[a-zA-Z0-9_-]+$/`, max length 100.

---

### L4. Unbounded User Preferences Payload Size

**File:** `infrastructure/lambda/src/userPreferences.ts:68-113`

Preferences JSON validated for format but not size. A user could store up to DynamoDB's 400KB item limit.

**Recommendation:** Add a 16KB size limit.

---

### L5. `title` and `providerId` Not Validated in `createChat`

**File:** `infrastructure/lambda/src/createChat.ts:41`

`VALIDATION_LIMITS.MAX_TITLE_LENGTH` (500 chars) is defined but never enforced in the handler.

**Recommendation:** Apply the existing validation limit.

---

### L6. No Message/Payload Size Limits in VTL Resolvers

**File:** `infrastructure/resolvers/saveMessage.put.req.vtl`

VTL resolvers for DynamoDB-direct operations accept unbounded input for `content`.

**Recommendation:** Add VTL length validation before writes.

---

### L7. Secrets Cached Indefinitely in Lambda Memory

**File:** `infrastructure/lambda/src/secrets.ts:11-15`

No TTL on the secrets cache. Rotated keys won't take effect until a cold start.

**Recommendation:** Add a 10-minute cache TTL.

---

### L8. Potential Data Inconsistency in User Service Two-Write Pattern

**File:** `infrastructure/lambda/src/userService.ts:88-107`

User creation writes two DynamoDB items sequentially without a transaction. If the first succeeds and the second fails, an orphaned mapping remains.

**Recommendation:** Use `TransactWriteCommand` for atomicity.

---

### L9. BatchWriteItem Does Not Handle UnprocessedItems

**File:** `infrastructure/lambda/src/deleteChat.ts:110-122`

Unprocessed items from DynamoDB batch deletes are silently dropped, potentially leaving orphaned messages.

**Recommendation:** Check `response.UnprocessedItems` and retry with backoff.

---

### L10. CloudWatch Log Retention is Short (14 Days)

**File:** `infrastructure/lambda.tf:93-100`

14-day retention may be insufficient for security incident investigation.

**Recommendation:** Increase to at least 90 days for production.

---

### L11. CloudWatch Log Groups Lack KMS Encryption

**File:** `infrastructure/lambda.tf:91-255`

Lambda logs (which may contain user IDs and error details) have no KMS encryption.

**Recommendation:** Add `kms_key_id` to all log groups.

---

### L12. Console Logging of User IDs

**Files:** `infrastructure/lambda/src/userService.ts:109`, `deleteChat.ts:34`, `chat.ts:76`, `judge.ts:137`

User activity logged at INFO level with both Clerk and internal user IDs, creating correlation data.

**Recommendation:** Mask or hash identifiers in logs. Use structured logging with appropriate levels.

---

### L13. No Lambda Reserved Concurrency Limits

**File:** `infrastructure/lambda.tf`

No `reserved_concurrent_executions` configured. A spike could exhaust the account's Lambda concurrency pool.

**Recommendation:** Set concurrency limits on chat and judge functions.

---

### L14. AppSync Logging at ERROR Level Only

**File:** `infrastructure/appsync.tf:17-20`

Only errors logged. Suspicious patterns and auth failures are not captured.

**Recommendation:** Set to `ALL` or `INFO` for production security monitoring.

---

## Informational

### I1. Legacy `chatStorage.ts` Module Still Present

**File:** `src/utils/chatStorage.ts`

Unused module designed to store chat history in `localStorage`. If imported, would store conversations client-side.

**Recommendation:** Delete if confirmed unused.

---

### I2. Stale Error Message References `VITE_APPSYNC_API_KEY`

**File:** `src/services/appsyncJudge.ts:47,108`

Error messages reference a nonexistent configuration variable.

**Recommendation:** Update to reference only `VITE_APPSYNC_URL`.

---

### I3. Sensitive Terraform Outputs Not Marked Sensitive

**File:** `infrastructure/outputs.tf:18-21`

`secrets_manager_secret_arn` and `secrets_manager_secret_name` not marked `sensitive = true`.

---

### I4. S3 Deployment Script Lacks `--sse` Flag

**File:** `scripts/deploy.sh:47-68`

No server-side encryption headers on S3 upload commands.

---

### I5. Weak ID Generation for `generateId()` (Duplicate of H1)

**File:** `src/utils/dummyResponses.ts:14`

The same `generateId()` function using `Math.random()`. Listed here for completeness as it was independently found during frontend analysis. The `crypto.randomUUID()` function is correctly used elsewhere (e.g., `requestId` in `appsyncChat.ts`).

---

### I6. Frontend S3 Bucket and CloudFront Not in Terraform

**Status:** Open (carried from prior review)

Frontend hosting infrastructure not managed by Terraform, so bucket security settings are not version-controlled.

---

### I7. Client-Side JWT Parsing Without Signature Verification

**File:** `src/services/appsyncClient.ts:35-51`

`extractUserIdFromToken` decodes JWTs via `atob()` for subscription filtering. Server-side validation is handled by AppSync. Acceptable for its use case.

---

### I8. Token Passed in WebSocket URL Query Parameter

**File:** `src/services/appsyncClient.ts:124-133`

Required by the AppSync WebSocket protocol. JWTs have limited lifetimes.

---

## Positive Security Observations

The following practices are well-implemented:

1. **No client-side API keys** -- All LLM calls route through AppSync to Lambda to Secrets Manager
2. **Proper auth flow** -- Clerk OIDC with JWT on every request; UI enforces auth gates
3. **No raw HTML rendering** -- `react-markdown` without `rehype-raw` or `allowDangerousHtml`
4. **No `eval()`/`innerHTML`/`dangerouslySetInnerHTML`** -- Zero instances found
5. **Parameterized GraphQL** -- All queries use variables, preventing injection
6. **Prompt injection protection** -- XML content isolation with escaping in judge system
7. **Atomic rate limiting** -- DynamoDB conditional updates for request counting
8. **VTL authorization checks** -- Ownership verified before all data mutations
9. **Conditional writes** -- `attribute_not_exists(PK)` prevents chat overwrites
10. **User ID decoupling** -- Internal IDs decouple data from auth provider
11. **TypeScript strict mode** -- Enabled on both frontend and backend
12. **S3 public access blocks** -- All four settings enabled on generated images bucket
13. **IAM scoping** -- Secrets Manager access limited to `GetSecretValue` on specific ARN
14. **DynamoDB TTL** -- Rate limit records auto-expire
15. **CloudWatch alarms** -- High invocation and error rate monitoring configured

---

## Recommended Prioritization for Trusted Tester Launch

### Must Fix Before Testers

| # | Finding | Effort |
|---|---------|--------|
| M2 | Add `client_id` to OIDC configuration | Trivial |
| M5 | Add subscription ownership VTL resolver | Small |
| M7 | Sanitize error messages returned to users | Small |
| M11 | Remove `VITE_OPENAI_API_KEY` from type declarations | Trivial |
| H1 | Replace `generateId()` with `crypto.randomUUID()` | Small |

### Should Fix Soon After Launch

| # | Finding | Effort |
|---|---------|--------|
| H3 | Move Gemini API key to request header | Small |
| M1 | Add Content Security Policy headers | Medium |
| M3 | Restrict Lambda AppSync IAM to `publishChunk` | Small |
| M4 | Split Lambda IAM roles by function | Medium |
| L3 | Add `chatId` format validation | Small |
| L4 | Add preferences size limit | Trivial |
| L5 | Enforce title length validation | Trivial |

### Plan For Production Readiness

| # | Finding | Effort |
|---|---------|--------|
| H2 | Migrate Terraform state to S3 backend | Medium |
| M6 | Add WAF protection on AppSync | Medium |
| M9 | Enable KMS encryption and PITR on DynamoDB | Small |
| M10 | Configure secrets rotation | Medium |
| L10 | Increase log retention to 90 days | Trivial |
| L11 | Add KMS encryption to CloudWatch log groups | Small |
| L13 | Set Lambda reserved concurrency limits | Small |
