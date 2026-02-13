# Security Analysis

Thorough security review of the chatbot application: React/TypeScript frontend, AWS AppSync GraphQL backend, Clerk OIDC authentication, Lambda functions calling LLM APIs (OpenAI, Anthropic, Gemini, Perplexity, Grok), DynamoDB persistence, and Terraform IaC.

**Overall risk level: MEDIUM** -- Several previously critical issues have been fixed (rate limiting, user ID race condition, input validation, subscription eavesdropping). Remaining issues are primarily infrastructure hardening and defense-in-depth concerns.

**Last reviewed:** 2026-02-13

---

## Summary of Changes Since Last Review

### Fixed Issues
- **Subscription eavesdropping** (was Critical in earlier review) -- Fixed by adding `userId` filter to subscription
- **createChat overwrite** (was Critical in earlier review) -- Fixed using `TransactWriteCommand` with `ConditionExpression: 'attribute_not_exists(PK)'`
- **Input validation in Lambdas** (was Critical in earlier review) -- Comprehensive validation added
- **Prompt injection in judge** (was Critical in earlier review) -- Improved with XML tags and escaping
- **Dead API key code** (was Critical in earlier review) -- Direct browser API files removed
- **Model allowlist** (was High in earlier review) -- Now enforced in validation
- **Race condition in userService** (was Critical #2) -- Fixed using try/catch with early return
- **No rate limiting** (was High #3) -- Fully implemented with per-user daily request and token limits

### New Features Since Last Review
- **Grok provider** -- New LLM provider (xAI) added, follows same security patterns as other providers
- **Judge follow-up handler** -- New `judgeFollowUp` Lambda with validation, rate limiting, and XML escaping

### Still Vulnerable
- Weak ID generation for chatId/messageId (High #1)
- Local Terraform state (High #2)
- Overly broad AppSync IAM policy (High #3)
- Gemini API key passed in URL query string (High #4, new)
- Pagination token injection in listChats (Medium #5, new)
- Data inconsistency in user service two-write pattern (Medium #6)
- VTL resolvers lack size validation (Medium #7)
- Error messages leak internal details (Medium #8)
- DynamoDB lacks explicit encryption and backup (Medium #9)
- Various lower-severity infrastructure and frontend hardening items

---

## High Severity

### 1. Weak ID generation still used for chatId and messageId

**Files:** `src/utils/dummyResponses.ts:13-15`, `src/App.tsx:165,566,572`

**Status:** Still vulnerable

While `requestId` was fixed to use `crypto.randomUUID()`, the weak ID generator is still used for chatId and messageId:

```typescript
// dummyResponses.ts:13-15 - still weak
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// App.tsx - uses weak generator
const chatId = generateId()  // line 165
id: generateId(),            // line 566 (message ID)
const botMessageId = generateId()  // line 572
```

`Math.random()` is not cryptographically secure. Combined with `Date.now()`, these IDs are predictable to an attacker who knows approximately when a chat or message was created.

**Impact:** Although the createChat overwrite vulnerability is fixed (the server rejects duplicate chatIds), predictable IDs still reduce defense-in-depth and could make other attacks easier if future code relies on ID unpredictability.

**Remediation:** Replace all uses of `generateId()` with `crypto.randomUUID()`.

---

### 2. Local Terraform state file

**File:** `infrastructure/main.tf:15-21`

**Status:** Still vulnerable

Terraform state is stored locally. The state contains sensitive values including the Secrets Manager ARN, IAM role ARNs, and the full AppSync configuration. The commented-out S3 backend at lines 16-20 shows intent to migrate but it hasn't happened yet.

**Impact:** Sensitive infrastructure details exposed if the state file leaks. No state locking means concurrent applies could corrupt state.

**Remediation:** Uncomment and configure the S3 backend with encryption, versioning, and DynamoDB state locking.

---

### 3. Overly broad AppSync GraphQL IAM policy on Lambda role

**File:** `infrastructure/iam.tf:44-61`

**Status:** Still vulnerable

```hcl
{
  Effect = "Allow"
  Action = ["appsync:GraphQL"]
  Resource = "${aws_appsync_graphql_api.chatbot.arn}/*"
}
```

The wildcard `/*` grants the Lambda execution role permission to call any GraphQL operation, not just `publishChunk`. If a Lambda function is compromised, it could execute any mutation or query including `createChat`, `deleteChat`, `saveMessage`, etc.

**Remediation:** Scope the resource to specific fields:
```
Resource = "${aws_appsync_graphql_api.chatbot.arn}/types/Mutation/fields/publishChunk"
```

---

### 4. Gemini API key passed in URL query string (NEW)

**File:** `infrastructure/lambda/src/providers/gemini.ts:61,193`

**Status:** New finding

```typescript
const url = `${GEMINI_API_BASE}/${modelName}:streamGenerateContent?key=${apiKey}&alt=sse`;
```

The Gemini API key is passed as a query parameter in the URL rather than in an HTTP header. All other providers (OpenAI, Anthropic, Perplexity, Grok) pass their API keys via the `Authorization` header.

**Impact:** Query parameters are commonly logged by proxies, CDNs, load balancers, and may appear in CloudWatch or other monitoring tools. Unlike headers, URL parameters are not typically redacted from logs. This creates a higher risk of API key exposure through log data.

**Remediation:** This is a limitation of Google's Generative AI REST API which requires the API key as a query parameter. Consider:
- Using the official `@google/generative-ai` SDK which handles auth internally
- Ensuring no intermediate logging captures full URLs
- Rotating the Gemini API key more frequently than other provider keys

---

## Medium Severity

### 5. Pagination token injection in listChats (NEW)

**File:** `infrastructure/lambda/src/listChats.ts:55`

**Status:** New finding

```typescript
ExclusiveStartKey: nextToken ? JSON.parse(Buffer.from(nextToken, 'base64').toString()) : undefined,
```

The `nextToken` pagination parameter is base64-decoded and parsed as JSON, then passed directly as DynamoDB's `ExclusiveStartKey` without validation. A malicious user could craft a nextToken that points to arbitrary DynamoDB key structures.

**Impact:** An attacker could manipulate the `ExclusiveStartKey` to attempt to iterate records outside their own partition. While the `KeyConditionExpression` (`PK = :pk`) constrains the query to the user's partition, the DynamoDB `ExclusiveStartKey` must match the partition -- if it doesn't, DynamoDB returns an error rather than leaking data. The primary risk is unexpected errors and potential denial-of-service via malformed tokens.

**Remediation:** Validate the decoded token structure before use:
```typescript
const parsedToken = JSON.parse(Buffer.from(nextToken, 'base64').toString());
if (parsedToken.PK !== `USER#${internalUserId}`) {
  throw new Error('Invalid pagination token');
}
```
Or use server-side opaque pagination (e.g., encrypt tokens with a server-side key).

---

### 6. Potential data inconsistency in user service

**File:** `infrastructure/lambda/src/userService.ts:88-107`

**Status:** Partially fixed (race condition fixed, two-write atomicity still an issue)

The race condition from the previous review is fixed -- the code now correctly uses try/catch with early return (lines 61-86). However, the user creation still writes two items sequentially without a transaction:

```typescript
// First write succeeds (line 62-76)
await docClient.send(new PutCommand({
  Item: { PK: `EXTUSER#${authProvider}#${externalUserId}`, ... }
}));

// Second write could fail for non-race reasons (line 89-107)
await docClient.send(new PutCommand({
  Item: { PK: `IUSER#${internalUserId}`, ... }
}));
```

If the first write succeeds but the second fails due to a network error or throttling, the EXTUSER mapping exists but the IUSER profile does not.

**Impact:** Orphaned EXTUSER records without corresponding IUSER profiles. May cause issues if reverse lookups are ever needed. In practice, the user would still function correctly since the EXTUSER mapping is what's queried during login.

**Remediation:** Use `TransactWriteCommand` to make both writes atomic.

---

### 7. No message or payload size limits in VTL resolvers

**Files:** `infrastructure/resolvers/saveMessage.put.req.vtl`

**Status:** Still vulnerable

While the Lambda handlers have comprehensive size limits (validation.ts), the VTL resolvers for DynamoDB-direct operations like `saveMessage` accept unbounded input. The `saveMessage.put.req.vtl` resolver writes `content` directly from `$ctx.args.input.content` without any size validation.

**Remediation:** Add length validation in VTL request templates:
```vtl
#if($ctx.args.input.content.length() > 32768)
  $util.error("Message content too large", "VALIDATION_ERROR")
#end
```

---

### 8. Error messages leak internal details

**Files:** `infrastructure/lambda/src/judge.ts:225`, `infrastructure/lambda/src/judgeFollowUp.ts:207`, `infrastructure/lambda/src/chat.ts:99`, `infrastructure/lambda/src/providers/gemini.ts:73`

**Status:** Still vulnerable

Error messages from LLM providers are passed through to clients:

```typescript
// judge.ts:225
explanation: `Error evaluating response: ${error instanceof Error ? error.message : 'Unknown error'}`,

// chat.ts:99
error instanceof Error ? error.message : 'Streaming error'

// gemini.ts:73
throw new Error(`Gemini API error: ${response.status} ${error}`);

// judge.ts:262 - Leaks up to 200 chars of raw judge response
throw new Error(`Failed to parse judge response: ${responseText.substring(0, 200)}`);
```

Provider error messages may contain internal details like API endpoint URLs, rate limit information, account identifiers, or model-specific error codes.

**Remediation:** Log full error details server-side to CloudWatch. Return generic error messages to clients (e.g., "An error occurred processing your request").

---

### 9. DynamoDB table lacks explicit encryption and backup configuration

**File:** `infrastructure/dynamodb.tf`

**Status:** Still vulnerable

No explicit `server_side_encryption` or `point_in_time_recovery` block. DynamoDB uses AWS-owned keys by default, which provides encryption but doesn't allow customer control over key management.

The table stores user chat history (potentially sensitive conversations), user ID mappings, and rate limit records.

**Remediation:**
```hcl
server_side_encryption {
  enabled     = true
  kms_key_arn = aws_kms_key.dynamodb.arn
}

point_in_time_recovery {
  enabled = true
}
```

---

### 10. Console logging of sensitive data

**Files:** `infrastructure/lambda/src/userService.ts:109`, `infrastructure/lambda/src/deleteChat.ts:34`, `infrastructure/lambda/src/listChats.ts:42`, `infrastructure/lambda/src/chat.ts:76`, `infrastructure/lambda/src/judge.ts:137`, `infrastructure/lambda/src/judgeFollowUp.ts:122`

**Status:** Still vulnerable

Various Lambda handlers log user IDs and operations at the default (INFO) level:

```typescript
// userService.ts:109
console.log(`Created new internal user ${internalUserId} for ${authProvider}:${externalUserId}`);

// deleteChat.ts:34
console.log(`Deleting chat ${chatId} for user ${internalUserId}`);

// chat.ts:76
console.log(`Processing chat request: ${requestId} for provider: ${provider}, internalUser: ${internalUserId}, externalUser: ${externalUserId}`);
```

**Impact:** User activity is logged in CloudWatch, creating a correlation between Clerk external user IDs and internal user IDs. Combined with the unencrypted CloudWatch logs (finding #11), this creates a privacy concern.

**Remediation:** Use structured logging with appropriate log levels. Avoid logging user IDs at INFO level in production. Consider masking or hashing user identifiers in logs.

---

### 11. CloudWatch log groups lack KMS encryption

**File:** `infrastructure/lambda.tf:91-255`

**Status:** Still vulnerable

All six Lambda CloudWatch log groups are created without a `kms_key_id`:

```hcl
resource "aws_cloudwatch_log_group" "chat" {
  name              = "/aws/lambda/${aws_lambda_function.chat.function_name}"
  retention_in_days = 14
  # No kms_key_id specified
}
```

Lambda logs may contain user messages (in error scenarios), user IDs, and error details. Without KMS encryption, anyone with CloudWatch Logs read access can view them.

**Remediation:** Create a KMS key and set `kms_key_id` on all log groups.

---

### 12. Secrets cache has no TTL (NEW)

**File:** `infrastructure/lambda/src/secrets.ts`

**Status:** New finding

The secrets module caches API keys in Lambda memory indefinitely after the first fetch. There is no TTL or cache invalidation mechanism.

**Impact:** If API keys are rotated in Secrets Manager, Lambda functions will continue using the old keys until a cold start occurs. This could extend the window of exposure for a compromised key and makes it difficult to perform emergency key rotations.

**Remediation:** Add a TTL to the cache (e.g., 5-15 minutes) so Lambda periodically refreshes secrets:
```typescript
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

if (cached && Date.now() - cachedAt < CACHE_TTL_MS) {
  return cached;
}
```

---

## Low Severity

### 13. No Lambda reserved concurrency limits (NEW)

**File:** `infrastructure/lambda.tf`

**Status:** New finding

None of the Lambda functions have `reserved_concurrent_executions` configured. All six functions share the account's default Lambda concurrency pool (typically 1000).

**Impact:** A spike in chat or judge requests could exhaust the account's Lambda concurrency, causing throttling across all Lambda functions in the account -- not just this application. Rate limiting mitigates per-user abuse, but coordinated attacks from multiple compromised accounts could still overwhelm concurrency.

**Remediation:** Set `reserved_concurrent_executions` on the chat and judge Lambdas to cap their concurrency and protect other account functions.

---

### 14. No AWS WAF on AppSync API (NEW)

**Files:** `infrastructure/appsync.tf`

**Status:** New finding

No AWS WAF WebACL is associated with the AppSync API. While Clerk OIDC authentication prevents unauthenticated access, there is no protection against:
- Rapid requests from authenticated users before rate limiting kicks in
- Layer 7 DDoS attacks against the authentication endpoint
- IP-based blocking of known malicious sources

**Remediation:** Create an `aws_wafv2_web_acl` with rate-based rules and associate it with the AppSync API.

---

### 15. Dual user ID namespace creates complexity

**Files:** `infrastructure/lambda/src/createChat.ts`, `infrastructure/resolvers/getChat.meta.res.vtl`

**Status:** Architectural concern (unchanged)

The system stores both `internalUserId` (for data organization) and `clerkId` (for VTL auth checks) in chat metadata. VTL resolvers check `clerkId`, while Lambda handlers use `internalUserId`.

This dual-ID architecture is technically sound but increases complexity and the potential for bugs if the two IDs get out of sync.

**Remediation:** Document the ID architecture clearly. Consider migrating VTL resolvers to Lambda for consistency.

---

### 16. BatchWriteItem does not handle UnprocessedItems

**File:** `infrastructure/lambda/src/deleteChat.ts:111-122`

**Status:** Still vulnerable

```typescript
await docClient.send(
  new BatchWriteCommand({
    RequestItems: {
      [TABLE_NAME]: batch.map((item) => ({
        DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
      })),
    },
  })
);
```

DynamoDB `BatchWriteItem` can return `UnprocessedItems` when it cannot process all items in the batch (due to throttling, for example). This code does not check for or retry unprocessed items.

**Impact:** Orphaned message records that are not deleted when a chat is deleted. These records would be inaccessible under normal operation but represent data that should have been removed.

**Remediation:** Check `response.UnprocessedItems` and retry with exponential backoff.

---

### 17. ReactMarkdown renders without explicit HTML restrictions

**File:** `src/components/ChatMessage.tsx:201-233`

**Status:** Still present

ReactMarkdown is used with `remarkGfm`, `remarkMath`, and `rehypeKatex` plugins but without explicit HTML element restrictions. By default, ReactMarkdown does not render raw HTML (it escapes it), so the immediate XSS risk is low. However, the `rehypeKatex` plugin processes LaTeX which has had historical XSS vectors in some versions.

**Remediation:** Add `rehype-sanitize` to the plugin chain, or explicitly configure `allowedElements` to whitelist safe elements.

---

### 18. S3 deployment lacks server-side encryption headers

**File:** `scripts/deploy.sh:47-68`

**Status:** Still vulnerable

No `--sse` flag is specified on the `aws s3 sync` or `aws s3 cp` commands.

**Remediation:** Add `--sse AES256` to all S3 upload commands.

---

### 19. AppSync logging at ERROR level only

**File:** `infrastructure/appsync.tf:19`

**Status:** Still present

```hcl
field_log_level = "ERROR"
```

Only errors are logged. Suspicious patterns (unusual query patterns, authorization failures) would not be captured.

**Remediation:** Set to `ALL` or at minimum `INFO` for security monitoring in production. Be aware this increases CloudWatch costs.

---

### 20. No Content-Security-Policy or security headers

**Status:** Still vulnerable

The application has no CSP, HSTS, X-Frame-Options, or other security headers configured. This would typically be done via a CloudFront response headers policy.

**Remediation:** Create an `aws_cloudfront_response_headers_policy` with:
- `Content-Security-Policy` restricting script sources
- `Strict-Transport-Security` with `max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`

---

### 21. S3 bucket not defined in Terraform (NEW)

**Status:** New finding

The frontend S3 bucket and CloudFront distribution are not defined in Terraform. Deployment relies on the `scripts/deploy.sh` script and externally created infrastructure. This means bucket security settings (public access blocks, encryption, CORS, bucket policy) are not version-controlled or auditable.

**Remediation:** Add S3 bucket and CloudFront distribution to Terraform with:
- `aws_s3_bucket_public_access_block` blocking all public access
- `aws_s3_bucket_server_side_encryption_configuration` with SSE-S3 or KMS
- CloudFront OAC (Origin Access Control) for bucket access
- Bucket policy allowing only CloudFront

---

## Informational

### Architecture positives

The following security practices are well-implemented:

- **Authentication:** Clerk OIDC with AppSync integration provides solid user authentication.
- **Internal-only mutations:** `publishChunk` is correctly restricted to `@aws_iam` (schema.graphql:189).
- **Ownership checks:** VTL resolvers verify `clerkId == context.identity.sub` before data access. Lambda handlers independently verify ownership using `internalUserId`.
- **Lambda secret management:** API keys are stored in Secrets Manager and loaded at runtime -- never in environment variables or code.
- **Input validation:** Comprehensive validation for message size (32KB per message, 200KB total), message count (100 max), provider allowlists, request ID format, and string field size limits (validation.ts).
- **Rate limiting:** Per-user daily limits on both requests (200/day) and tokens (2M/day) with atomic DynamoDB operations and TTL-based auto-cleanup (rateLimiter.ts). Applied to chat, judge, and judge follow-up operations.
- **Subscription filtering:** `onMessageChunk` filters by both `requestId` and `userId` to prevent cross-user eavesdropping.
- **Prompt injection mitigation:** Judge system uses XML tags with content escaping (`escapeXmlContent`), separate system/user messages, think-block stripping, and explicit instructions to ignore injected instructions (judge.ts, judgeFollowUp.ts).
- **Internal user IDs:** Decouples data model from auth provider, enabling future migrations (userService.ts). Race condition previously identified is now fixed.
- **Monitoring:** CloudWatch alarms for high invocations (chat and judge), error rates, and billing thresholds with SNS email notifications (cloudwatch.tf).
- **Consistent auth directives:** All queries and mutations in schema.graphql have explicit `@aws_oidc` or `@aws_iam` directives.
- **Least-privilege IAM:** Secrets Manager access limited to `GetSecretValue` on a specific secret ARN. AppSync-to-Lambda invoke scoped to exact function ARNs. DynamoDB access scoped to specific table ARN.
- **createChat overwrite prevention:** `TransactWriteCommand` with `attribute_not_exists(PK)` condition prevents chat ID collisions.

### Subscription security model

The subscription requires both `requestId` and `userId`:

```graphql
onMessageChunk(requestId: String!, userId: String!): MessageChunk
  @aws_subscribe(mutations: ["publishChunk"])
  @aws_oidc
```

This prevents eavesdropping as long as:
1. The Lambda publishes chunks with the correct `userId` (verified in chat.ts -- uses `externalUserId` from `identity.sub`)
2. AppSync filters subscription events by the provided arguments

### Rate limiting implementation

The rate limiter (rateLimiter.ts) implements a robust pattern:
1. **Token budget check** (read-only) -- prevents burning a request slot if already over budget
2. **Atomic request count increment** -- uses DynamoDB `ConditionExpression` to atomically check and increment
3. **Token usage recording** -- tracks tokens consumed for budget enforcement
4. **TTL-based cleanup** -- rate limit records auto-expire via DynamoDB TTL (2 days)
5. **Configurable limits** -- set via Terraform variables (`rate_limit_daily_requests`, `rate_limit_daily_tokens`)

All three LLM-calling Lambdas (chat, judge, judgeFollowUp) now enforce rate limits.

---

## Remediation priority

Recommended ordering for fixes:

1. **Gemini API key in URL** (finding #4) -- API key exposure risk, quick fix by switching to SDK
2. **Weak ID generation** (finding #1) -- Replace `generateId()` with `crypto.randomUUID()`
3. **IAM policy scoping** (finding #3) -- Restrict to `publishChunk` only
4. **Pagination token validation** (finding #5) -- Validate decoded token structure
5. **Error message sanitization** (finding #8) -- Stop leaking provider error details
6. **Terraform state** (finding #2) -- Migrate to S3 backend
7. **User service atomicity** (finding #6) -- Use `TransactWriteCommand`
8. **DynamoDB encryption/backup** (finding #9) -- Enable KMS and PITR
9. **Secrets cache TTL** (finding #12) -- Add TTL to secrets caching
10. Everything else (VTL validation, log encryption, CSP headers, WAF, Lambda concurrency, S3 in Terraform)
