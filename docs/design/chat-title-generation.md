# Chat Title Generation

## Problem

When a user starts a new chat, the title is set to the first 30 characters of their first message (with "..." appended if truncated). This produces low-quality titles like:

- "Can you help me debug this iss..."
- "What's the best way to implem..."
- "I need to write a Python scrip..."

Apps like ChatGPT and Gemini use an LLM to generate concise, descriptive titles that summarize the conversation's topic. We should do the same.

## Current Behavior

1. User clicks "New Chat" → title is set to `"New Chat"`
2. User sends first message → `generateChatTitle()` truncates the message to 30 chars
3. Title is updated optimistically in local state and persisted to DynamoDB via `updateChat`
4. User can manually rename by double-clicking the title in the sidebar

Relevant code:
- `src/services/chatHistoryService.ts:176-182` — `generateChatTitle()` (truncation logic)
- `src/App.tsx:710` — title generation on first message
- `src/App.tsx:740-746` — DynamoDB persistence of title

## Design

### Approach: Backend Lambda with Non-Blocking Title Update

Add a new `generateTitle` Lambda function that accepts a chat's messages and returns an LLM-generated title. The frontend calls it after the first assistant response completes, then updates the title in both local state and DynamoDB.

### Why backend, not frontend?

- API keys are in Secrets Manager and are only accessible from Lambda. The frontend has no direct LLM access.
- Consistent with the existing architecture where all LLM calls go through AppSync → Lambda.
- Backend can use whichever model is cheapest/fastest regardless of the chat's selected provider.

### Why after the assistant response, not after the first user message?

- Having both the user's question and the assistant's answer produces significantly better titles. The assistant response reveals what the conversation is actually about, not just what the user asked.
- ChatGPT and Gemini both follow this pattern — the title appears/updates after the first response.
- The title update is non-blocking, so the slight delay is invisible to the user.

### Model Selection

Use **Gemini 2.0 Flash** (`gemini-2.0-flash`) via the existing Gemini provider infrastructure. Rationale:

- Extremely fast (~200-400ms for a short completion)
- Very cheap ($0.10/1M input tokens, essentially free for a single short prompt)
- Title generation is a trivial task — no need for a frontier model
- We already have a Gemini API key in Secrets Manager
- Alternatively, `gpt-4.1-mini` or `claude-haiku` would also work; Gemini Flash is cheapest

The model should be configurable via an environment variable (`TITLE_MODEL`) with a sensible default, so it can be changed without a code deploy.

## Detailed Design

### 1. GraphQL Schema Addition

Add a new mutation and return type to `infrastructure/schema.graphql`:

```graphql
input GenerateTitleInput {
  chatId: String!
  messages: [ChatMessageInput!]!
}

type GenerateTitleResult {
  chatId: String!
  title: String!
}

type Mutation {
  # ... existing mutations ...
  generateTitle(input: GenerateTitleInput!): GenerateTitleResult!
    @aws_oidc
}
```

This reuses the existing `ChatMessageInput` type. The `chatId` is included so the Lambda can persist the title directly, saving a round-trip.

### 2. Lambda Function: `generateTitle`

New file: `infrastructure/lambda/src/generateTitle.ts`

**Responsibilities:**
1. Receive `chatId` and recent messages
2. Call a fast LLM with a title generation prompt
3. Persist the generated title to DynamoDB via the existing `updateChat` pattern (update both `CHAT#<id>/META` and `USER#<userId>/CHAT#<id>` items)
4. Return the generated title

**Prompt:**

```
Generate a short, descriptive title (3-6 words) for this conversation.
Rules:
- No quotes or punctuation wrapping the title
- No prefixes like "Title:" or "Chat:"
- Capture the specific topic, not generic descriptions
- Use title case

Conversation:
<first user message and first assistant response, truncated to ~500 tokens>
```

Only the first user message and first assistant response are sent. This keeps the prompt small and the cost negligible.

**Error handling:** If the LLM call fails, fall back to the existing truncation behavior. Title generation is best-effort — failures should never affect the chat experience.

**Input validation:**
- Messages array must be non-empty
- chatId must be non-empty
- Enforce a maximum message content length (e.g., 2000 chars) to prevent abuse

### 3. Infrastructure: Terraform

New resources in `infrastructure/lambda.tf`:

```hcl
resource "aws_lambda_function" "generate_title" {
  filename         = data.archive_file.lambda_package.output_path
  function_name    = "${var.project_name}-${var.environment}-generate-title"
  role             = aws_iam_role.lambda_execution.arn
  handler          = "generateTitle.handler"
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  runtime          = "nodejs22.x"
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      SECRETS_NAME        = aws_secretsmanager_secret.llm_api_keys.name
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.chats.name
      TITLE_MODEL         = "gemini-2.0-flash"  # Configurable
    }
  }
}
```

Plus: AppSync datasource, resolver, CloudWatch log group, and IAM policies (Secrets Manager read, DynamoDB write). Follow the existing patterns from `create_chat` and `judge` Lambdas.

### 4. Frontend Changes

**`src/services/chatHistoryService.ts`:**

Add a new `generateTitle()` service function:

```typescript
export async function generateChatTitleRemote(
  chatId: string,
  messages: Message[]
): Promise<string> {
  const result = await executeGraphQL<{ generateTitle: GenerateTitleResult }>(
    GENERATE_TITLE_MUTATION,
    {
      input: {
        chatId,
        messages: messages.slice(0, 2).map((m) => ({
          role: m.role,
          content: m.content.slice(0, 2000),
        })),
      },
    }
  );
  return result.generateTitle.title;
}
```

Keep the existing `generateChatTitle()` function as-is for the immediate/fallback title.

**`src/graphql/operations.ts`:**

Add the mutation string and TypeScript types for `generateTitle`.

**`src/App.tsx`** — modify the first-message flow:

```
Before (current):
  1. User sends message → generateChatTitle() → truncated title → updateChat

After (proposed):
  1. User sends message → generateChatTitle() → truncated title (immediate, optimistic)
  2. Assistant response completes → generateChatTitleRemote() → LLM title → update local state
     (The Lambda persists to DynamoDB internally, so no separate updateChat call needed)
```

The truncated title acts as a placeholder. Once the LLM title arrives, it replaces the placeholder in local state. The sidebar updates reactively since it renders from the chats state array.

**Where to trigger:** In the `.then()` handler after the streaming promise resolves successfully (around `src/App.tsx:788`), if it was the first message and the chat is not incognito:

```typescript
// After streaming completes successfully for the first message
if (isFirstMessage && !isIncognito) {
  generateChatTitleRemote(chatIdForStream, [userMessage, { role: 'assistant', content: finalResponse }])
    .then((title) => {
      setChats((prev) =>
        prev.map((c) => (c.id === chatIdForStream ? { ...c, title } : c))
      );
    })
    .catch((err) => console.error('Failed to generate title:', err));
}
```

### 5. Incognito Chats

Incognito chats skip all DynamoDB persistence. For incognito chats, we have two options:

**Option A (Recommended): Skip LLM title generation entirely.** Keep the truncated-message title. Incognito chats are ephemeral and sending their content to an LLM for title generation may violate user expectations of privacy.

**Option B:** Call the LLM but don't persist. This gives nicer titles in the sidebar during the session but sends conversation content to a third-party API, which conflicts with the purpose of incognito mode.

### 6. Rate Limiting

Title generation is a lightweight, low-cost call, but it should still be bounded:

- **Don't count toward the user's existing chat rate limit.** Title generation is an internal UX enhancement, not a user-initiated LLM call. Counting it would penalize users unfairly.
- **Natural throttle:** One title generation per chat, triggered only on the first message. There's no way to spam it through normal usage.
- **Lambda timeout:** 15 seconds is sufficient. If the LLM is slow, the Lambda times out and the fallback title remains.

## UX Details

### Title Transition

When the LLM-generated title arrives, the sidebar title updates in-place. No loading spinner or skeleton is needed — the truncated title serves as a reasonable placeholder, and the transition to the LLM title is a minor visual update. This matches how ChatGPT handles it (the title simply appears/changes in the sidebar).

### Manual Renames

If the user has already manually renamed the chat (double-click rename) before the LLM title arrives, the manual rename should take precedence. To handle this:

- Track whether the user has manually renamed the chat (e.g., a `userRenamed` flag or compare against the known truncated title)
- Or more simply: if the current title doesn't match the truncated placeholder, skip the LLM title update

### Edge Cases

| Case | Behavior |
|------|----------|
| LLM call fails | Keep truncated title, log error |
| LLM returns empty/nonsensical title | Keep truncated title |
| User renames before LLM responds | Keep user's manual title |
| User deletes chat before LLM responds | Ignore the response (chat gone) |
| User sends second message before LLM title | Still use first user + first assistant messages |
| Incognito chat | Skip LLM title generation |
| Very short user message ("Hi") | LLM still generates title from assistant response context |
| Very long user message | Truncate to 2000 chars before sending to LLM |

## File Changes Summary

| File | Change |
|------|--------|
| `infrastructure/schema.graphql` | Add `GenerateTitleInput`, `GenerateTitleResult`, `generateTitle` mutation |
| `infrastructure/lambda/src/generateTitle.ts` | New Lambda handler |
| `infrastructure/lambda.tf` | New Lambda function, datasource, resolver, log group |
| `infrastructure/appsync.tf` | New resolver + datasource attachment |
| `infrastructure/iam.tf` | Add Secrets Manager + DynamoDB permissions for new Lambda |
| `src/graphql/operations.ts` | Add `GENERATE_TITLE_MUTATION` and types |
| `src/services/chatHistoryService.ts` | Add `generateChatTitleRemote()` function |
| `src/App.tsx` | Call `generateChatTitleRemote()` after first response completes |

## Cost Estimate

Gemini 2.0 Flash pricing: ~$0.10/1M input tokens, ~$0.40/1M output tokens.

A typical title generation request:
- Input: ~100-200 tokens (prompt + truncated messages)
- Output: ~5-10 tokens (the title)
- Cost per title: ~$0.00002 (negligible)

At 1,000 new chats/day: ~$0.02/day, ~$0.60/month.

## Alternatives Considered

### Frontend-only with a cheap API call
Not feasible — API keys are only available server-side.

### Generate title in the existing chat Lambda
Could append title generation to the end of `chat.ts` after streaming completes. This avoids a new Lambda but couples title generation to chat streaming, making the chat Lambda's job less focused. It also means if title generation is slow, it delays the Lambda's cleanup. A separate Lambda is cleaner and matches the existing pattern of one-Lambda-per-concern.

### Use the chat's selected provider for title generation
Wasteful and inconsistent. Generating a title with GPT-5.2 or Claude Sonnet 4.6 is overkill. A dedicated cheap model is more cost-effective and predictable.

### Generate title from user message only (no assistant response)
Produces worse titles. "Help me with React hooks" could be about useState, useEffect, custom hooks, or debugging. The assistant's response disambiguates the topic.
