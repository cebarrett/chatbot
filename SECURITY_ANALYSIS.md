# Security Analysis

Thorough security review of the chatbot application: React/TypeScript frontend, AWS AppSync GraphQL backend, Clerk OIDC authentication, Lambda functions calling LLM APIs (OpenAI, Anthropic, Gemini), DynamoDB persistence, and Terraform IaC.

**Overall risk level: MEDIUM-HIGH** -- Several critical issues have been fixed (input validation, subscription eavesdropping, dead API key code), but some remain (chat overwrite vulnerability, rate limiting) and the internal user ID implementation introduced new issues.

**Last reviewed:** 2026-02-05

---

## Summary of Changes Since Last Review

### Fixed Issues
- **Subscription eavesdropping** (was Critical #1) -- Fixed by adding `userId` filter to subscription
- **createChat overwrite** (was Critical #2) -- Fixed using `TransactWriteCommand` with `ConditionExpression: 'attribute_not_exists(PK)'`
- **Input validation in Lambdas** (was Critical #3) -- Comprehensive validation added
- **Prompt injection in judge** (was Critical #4) -- Improved with XML tags and escaping
- **Dead API key code** (was Critical #5) -- Direct browser API files removed
- **Model allowlist** (was High #9) -- Now enforced in validation

### Partially Fixed
- **Weak ID generation** (was High #7) -- `requestId` now uses `crypto.randomUUID()`, but `chatId` and `messageId` still use weak generator

### Still Vulnerable
- **No rate limiting** (was High #6) -- No changes
- **Local Terraform state** (was High #8) -- No changes

### New Issues Introduced
- Race condition in internal user ID creation (Critical)
- Potential data inconsistency in user service (Medium)

---

## Critical Severity

### 1. createChat allows overwriting other users' chats (FIXED)

**Files:** `infrastructure/lambda/src/createChat.ts:53-115`

**Status:** Fixed

The `createChat` Lambda now uses `TransactWriteCommand` with a condition expression `attribute_not_exists(PK)` on the chat metadata item. This prevents any write if a chat with that ID already exists, returning a clear error message to the client.

```typescript
await docClient.send(
  new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: { PK: `CHAT#${chatId}`, SK: 'META', ... },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      // ...
    ],
  })
);
```

The error handling checks for `TransactionCanceledException` with `ConditionalCheckFailed` and returns a user-friendly error message.

---

### 2. Race condition in internal user ID creation

**Files:** `infrastructure/lambda/src/userService.ts:61-84`

The `getOrCreateInternalUserId` function has a race condition bug. When a concurrent request creates a mapping first, the `.catch()` handler tries to return the existing mapping's ID, but the return value is lost:

```typescript
await docClient.send(
  new PutCommand({
    // ...
    ConditionExpression: 'attribute_not_exists(PK)',
  })
).catch(async (error) => {
  if (error.name === 'ConditionalCheckFailedException') {
    const mapping = await getUserMapping(externalUserId, authProvider);
    if (mapping) {
      return mapping.internalUserId;  // BUG: This return goes to the catch, not the caller!
    }
  }
  throw error;
});
```

The function then continues with the newly generated `internalUserId` instead of the one from the existing mapping, creating orphaned `IUSER#` records and potentially using different internal IDs for the same external user in different requests.

**Impact:** Race conditions during first login could result in:
- Multiple internal user IDs for the same Clerk user
- Orphaned IUSER records in DynamoDB
- Data isolation failures (user's chats split across multiple internal IDs)

**Remediation:** Properly handle the race condition:
```typescript
try {
  await docClient.send(new PutCommand({...}));
} catch (error) {
  if (error.name === 'ConditionalCheckFailedException') {
    const mapping = await getUserMapping(externalUserId, authProvider);
    if (mapping) {
      return mapping.internalUserId;  // Early return from function
    }
  }
  throw error;
}
```

---

## High Severity

### 3. No rate limiting on any API operation (STILL VULNERABLE)

**Files:** `infrastructure/schema.graphql`, `infrastructure/appsync.tf`, `infrastructure/lambda.tf`

There is no rate limiting at any layer:
- No AWS WAF attached to the AppSync API.
- No AppSync-level throttling configuration.
- No Lambda reserved concurrency limits.
- No per-user request counting in the application.

Every authenticated user can make unlimited calls to `sendMessage` and `judgeResponse`, each of which invokes an LLM API call billed per token.

**Impact:** A single malicious or compromised user account can run up arbitrary LLM API costs. A coordinated attack could exhaust Lambda concurrency limits, causing denial of service for all users.

**Remediation:**
- Attach AWS WAF to the AppSync API with rate-based rules.
- Set `reserved_concurrent_executions` on Lambda functions.
- Implement per-user request counting (e.g., DynamoDB counter with TTL, or token bucket in Lambda).

---

### 4. Weak ID generation still used for chatId and messageId

**Files:** `src/utils/dummyResponses.ts:17-19`, `src/App.tsx:132,303,309`

While `requestId` was fixed to use `crypto.randomUUID()`, the weak ID generator is still used for other IDs:

```typescript
// dummyResponses.ts - still weak
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// App.tsx - uses weak generator
const chatId = generateId()  // line 132
id: generateId(),            // line 303 (message ID)
const botMessageId = generateId()  // line 309
```

`Math.random()` is not cryptographically secure. Combined with `Date.now()`, these IDs are predictable to an attacker who knows approximately when a chat or message was created.

**Impact:** Enables the chat overwrite attack (finding #1) by making chatIds guessable.

**Remediation:** Replace all uses of `generateId()` with `crypto.randomUUID()`.

---

### 5. Local Terraform state file (STILL VULNERABLE)

**File:** `infrastructure/main.tf`

Terraform state is still stored locally. The state contains sensitive values including the Secrets Manager ARN, IAM role ARNs, and the full AppSync configuration.

**Impact:** Sensitive infrastructure details exposed if the state file leaks.

**Remediation:** Enable the S3 backend with encryption, versioning, and DynamoDB state locking.

---

### 6. Overly broad AppSync GraphQL IAM policy on Lambda role (STILL VULNERABLE)

**File:** `infrastructure/iam.tf:53-61`

```hcl
{
  Effect = "Allow"
  Action = ["appsync:GraphQL"]
  Resource = "${aws_appsync_graphql_api.chatbot.arn}/*"
}
```

The wildcard `/*` grants the Lambda execution role permission to call any GraphQL operation, not just `publishChunk`. If a Lambda function is compromised, it could execute any mutation or query.

**Remediation:** Scope the resource to specific fields:
```
Resource = "${aws_appsync_graphql_api.chatbot.arn}/types/Mutation/fields/publishChunk"
```

---

## Medium Severity

### 7. Potential data inconsistency in user service

**File:** `infrastructure/lambda/src/userService.ts:87-105`

The user creation writes two items: EXTUSER mapping and IUSER profile. If the first succeeds but the second fails for a non-race-condition reason (network error, throttling), the data is left inconsistent.

```typescript
// First write succeeds
await docClient.send(new PutCommand({
  Item: { PK: `EXTUSER#${authProvider}#${externalUserId}`, ... }
}));

// Second write fails (e.g., network error)
await docClient.send(new PutCommand({
  Item: { PK: `IUSER#${internalUserId}`, ... }
})).catch((error) => {
  if (error.name !== 'ConditionalCheckFailedException') {
    throw error;  // EXTUSER exists but IUSER doesn't
  }
});
```

**Impact:** Orphaned EXTUSER records without corresponding IUSER profiles. May cause issues if reverse lookups are ever needed.

**Remediation:** Use `TransactWriteCommand` to make both writes atomic.

---

### 8. No message or payload size limits in VTL resolvers

**Files:** `infrastructure/resolvers/saveMessage.put.req.vtl`, `infrastructure/resolvers/createChat.req.vtl`

While the Lambda handlers now have size limits, the VTL resolvers for `saveMessage` and DynamoDB-direct operations still accept unbounded input.

**Remediation:** Add length validation in VTL request templates using `$util.validate()`.

---

### 9. Error messages still leak internal details

**Files:** `infrastructure/lambda/src/judge.ts:159`, `infrastructure/lambda/src/chat.ts:85`

Error messages from LLM providers are still passed through to clients:

```typescript
// judge.ts
explanation: `Error evaluating response: ${error instanceof Error ? error.message : 'Unknown error'}`,

// chat.ts
message: error instanceof Error ? error.message : 'Unknown error',
```

**Remediation:** Log full error details server-side to CloudWatch. Return generic error messages to clients.

---

### 10. DynamoDB table lacks explicit encryption and backup configuration (STILL VULNERABLE)

**File:** `infrastructure/dynamodb.tf`

No explicit `server_side_encryption` or `point_in_time_recovery` block.

**Remediation:** Add explicit encryption and PITR:
```hcl
server_side_encryption { enabled = true }
point_in_time_recovery { enabled = true }
```

---

### 11. Console logging of sensitive data

**Files:** `infrastructure/lambda/src/userService.ts:107`, `infrastructure/lambda/src/deleteChat.ts:34`, `infrastructure/lambda/src/listChats.ts:42`

Various files log user IDs and operations:

```typescript
// userService.ts
console.log(`Created new internal user ${internalUserId} for ${authProvider}:${externalUserId}`);

// deleteChat.ts
console.log(`Deleting chat ${chatId} for user ${internalUserId}`);
```

**Remediation:** Use structured logging. Avoid logging user IDs at INFO level in production.

---

### 12. CloudWatch log groups lack KMS encryption (STILL VULNERABLE)

**File:** `infrastructure/lambda.tf:87-103`

Lambda logs may contain user messages and error details. Without KMS encryption, anyone with CloudWatch read access can view them.

**Remediation:** Create a KMS key and set `kms_key_id` on all log groups.

---

## Low Severity

### 13. Dual user ID namespace creates complexity

**Files:** `infrastructure/lambda/src/createChat.ts:62-63`, `infrastructure/resolvers/getChat.meta.res.vtl:8`

The system now stores both `internalUserId` (for data organization) and `clerkId` (for VTL auth checks) in chat metadata. VTL resolvers check `clerkId`, while Lambda handlers use `internalUserId`.

```typescript
// createChat.ts - stores both
internalUserId,
clerkId,
```

```vtl
// getChat.meta.res.vtl - checks clerkId
#if($ctx.result.clerkId != $context.identity.sub)
```

This dual-ID architecture is technically sound but increases complexity and the potential for bugs if the two IDs get out of sync.

**Remediation:** Document the ID architecture clearly. Consider migrating VTL resolvers to Lambda for consistency.

---

### 14. BatchWriteItem does not handle UnprocessedItems (STILL VULNERABLE)

**File:** `infrastructure/lambda/src/deleteChat.ts:111-121`

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

DynamoDB `BatchWriteItem` can return `UnprocessedItems`. This code does not retry unprocessed items.

**Impact:** Orphaned message records that may be accessible if the chatId is reused.

**Remediation:** Check `response.UnprocessedItems` and retry with exponential backoff.

---

### 15. ReactMarkdown renders without explicit HTML restrictions (STILL VULNERABLE)

**File:** `src/components/ChatMessage.tsx`

No explicit configuration to prevent HTML rendering.

**Remediation:** Explicitly configure `allowedElements` or add `disallowedElements`.

---

### 16. S3 deployment lacks server-side encryption headers (STILL VULNERABLE)

**File:** `scripts/deploy.sh`

No `--sse` flag is specified.

**Remediation:** Add `--sse AES256` to all `aws s3` commands.

---

### 17. AppSync logging at ERROR level only (STILL VULNERABLE)

**File:** `infrastructure/appsync.tf:19`

Only errors are logged. Suspicious patterns would not be captured.

**Remediation:** Set to `ALL` or `INFO` for security monitoring.

---

### 18. No Content-Security-Policy or security headers (STILL VULNERABLE)

The application has no CSP, HSTS, or X-Frame-Options headers configured.

**Remediation:** Configure CloudFront response headers policy.

---

## Informational

### Architecture positives

The following security practices are well-implemented:

- **Authentication:** Clerk OIDC with AppSync integration provides solid user authentication.
- **Internal-only mutations:** `publishChunk` is correctly restricted to `@aws_iam`.
- **Ownership checks:** VTL resolvers verify `clerkId == context.identity.sub` before proceeding.
- **Lambda secret management:** API keys are stored in Secrets Manager and loaded at runtime.
- **Input validation:** Comprehensive validation added for message size, count, and model allowlists.
- **Subscription filtering:** `onMessageChunk` now filters by both `requestId` and `userId`.
- **Prompt injection mitigation:** Judge uses XML tags with escaping and separate system/user messages.
- **Internal user IDs:** Decouples data model from auth provider (good design, has bugs in implementation).

### Subscription security model

The subscription now requires both `requestId` and `userId`:

```graphql
onMessageChunk(requestId: String!, userId: String!): MessageChunk
```

This prevents eavesdropping as long as:
1. The Lambda publishes chunks with the correct `userId`
2. AppSync filters subscription events by the provided arguments

The implementation correctly passes `externalUserId` (Clerk ID) to `publishChunk` and the frontend subscribes with the same ID.

---

## Remediation priority

Recommended ordering for fixes:

1. **Race condition in userService** (finding #2) -- Bug causing data integrity issues
2. ~~**createChat overwrite vulnerability** (finding #1) -- Critical authorization bypass~~ **FIXED**
3. **Weak ID generation** (finding #4) -- Still enables ID guessing (reduced severity with #1 fixed)
4. **Rate limiting** (finding #3) -- Denial-of-wallet protection
5. **IAM policy scoping** (finding #6) -- Least privilege
6. **Data inconsistency in user service** (finding #7) -- Use transactions
7. **Terraform state** (finding #5) -- Infrastructure security
8. **DynamoDB encryption/backup** (finding #10) -- Data protection
9. Everything else
