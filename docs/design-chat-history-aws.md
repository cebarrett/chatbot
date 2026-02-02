# Design: Server-Side Chat History with DynamoDB

## Status

**Proposed** | February 2026

## Problem Statement

Chat history is currently stored entirely in browser `localStorage` (`src/utils/chatStorage.ts`). This has several limitations:

- **No cross-device access** -- Users lose their history when switching browsers or devices.
- **Data loss** -- Clearing browser data or localStorage limits being hit silently deletes all history.
- **No backend awareness** -- The server has no record of past conversations, preventing future features like search, analytics, or admin tooling.
- **Storage limits** -- Browsers typically cap localStorage at 5-10 MB. Heavy users with long conversations will hit this silently.
- **No sharing or collaboration** -- Conversations can't be referenced, shared, or exported from a central store.

## Goals

1. Persist chat history per-user in AWS, accessible from any device.
2. Preserve the existing UX -- sidebar listing, chat selection, deletion, title generation.
3. Keep the real-time streaming architecture (AppSync subscriptions) unchanged.
4. Maintain security: users can only access their own data.
5. Support the existing data model including judge ratings and provider tracking.

## Non-Goals

- Full-text search over message content (future work).
- Sharing chats between users.
- Chat history export/import.
- Migrating existing localStorage data to DynamoDB.

---

## Current Architecture

```
┌────────────────────┐      ┌─────────────────────┐
│  React Frontend    │──────│  AppSync (GraphQL)   │
│                    │  WS  │  OIDC + IAM auth     │
│  localStorage for  │      │                      │
│  all chat history  │      │  sendMessage ──► Chat Lambda ──► LLM APIs
│                    │      │  judgeResponse ──► Judge Lambda
└────────────────────┘      └─────────────────────┘
```

### Current Data Flow

1. `App.tsx` loads all chats from localStorage on mount via `loadChats()`.
2. User sends a message -- it's added to React state, then persisted to localStorage via a `useEffect` that calls `saveChats()` on every state change.
3. LLM responses stream in via AppSync subscriptions, updating React state (and thus localStorage) chunk by chunk.
4. Judge ratings arrive asynchronously and are patched into the message in state.

### Current Data Model (`src/types/index.ts`)

```typescript
interface Message {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
  judgeRatings?: Record<string, QualityRating>  // judgeId → rating
}

interface Chat {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
  providerId?: string  // 'claude' | 'openai' | 'gemini'
}
```

---

## Proposed Architecture

```
┌────────────────────┐      ┌─────────────────────┐      ┌──────────────┐
│  React Frontend    │──────│  AppSync (GraphQL)   │──────│  DynamoDB    │
│                    │  WS  │  OIDC + IAM auth     │      │              │
│  In-memory state   │      │                      │      │  Chats table │
│  (no localStorage) │      │  CRUD resolvers ─────┼──────│              │
│                    │      │  (direct DynamoDB)    │      │              │
│                    │      │                      │      └──────────────┘
│                    │      │  sendMessage ──► Chat Lambda ──► LLM APIs
│                    │      │  judgeResponse ──► Judge Lambda
└────────────────────┘      └─────────────────────┘
```

### Key Design Decisions

**DynamoDB** is the right choice here because:
- Already in the AWS ecosystem alongside AppSync, Lambda, and IAM.
- AppSync has a native DynamoDB data source with VTL resolver support -- no Lambda needed for basic CRUD.
- Pay-per-request pricing fits a chat app with bursty, unpredictable traffic.
- Single-digit millisecond latency for key-value lookups.
- No server/connection pool management (unlike RDS).

**AppSync DynamoDB resolvers** (not Lambda) for CRUD:
- Lower latency and cost than routing through Lambda.
- VTL request/response mapping templates handle the DynamoDB operations directly.
- Keeps Lambda functions focused on LLM orchestration.

---

## DynamoDB Table Design

### Single-Table Design

One table: `chatbot-{env}-chats`

| Access Pattern | PK | SK | Notes |
|---|---|---|---|
| Get all chats for a user (list) | `USER#{userId}` | `CHAT#{chatId}` | Returns chat metadata (no messages) |
| Get a single chat with messages | `CHAT#{chatId}` | `META` | Chat metadata |
| Get messages for a chat | `CHAT#{chatId}` | `MSG#{timestamp}#{messageId}` | Sorted by timestamp |
| Get user's chats sorted by time | `USER#{userId}` | `CHAT#{updatedAt}#{chatId}` | GSI not needed, SK sorts |

### Item Schemas

**Chat Metadata Item** (PK = `CHAT#{chatId}`, SK = `META`)

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | `CHAT#{chatId}` |
| `SK` | String | `META` |
| `userId` | String | Clerk user ID (`sub` claim) |
| `chatId` | String | UUID |
| `title` | String | Chat title |
| `providerId` | String | `claude`, `openai`, `gemini` |
| `createdAt` | String | ISO 8601 timestamp |
| `updatedAt` | String | ISO 8601 timestamp |
| `messageCount` | Number | Total messages in the chat |

**Message Item** (PK = `CHAT#{chatId}`, SK = `MSG#{timestamp}#{messageId}`)

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | `CHAT#{chatId}` |
| `SK` | String | `MSG#{timestamp}#{messageId}` |
| `messageId` | String | UUID |
| `chatId` | String | UUID (denormalized for queries) |
| `role` | String | `user` or `assistant` |
| `content` | String | Message text |
| `timestamp` | String | ISO 8601 timestamp |
| `judgeRatings` | Map | `{ judgeId: { score, explanation, problems } }` |

**User-Chat Index Item** (PK = `USER#{userId}`, SK = `CHAT#{updatedAt}#{chatId}`)

| Attribute | Type | Description |
|---|---|---|
| `PK` | String | `USER#{userId}` |
| `SK` | String | `CHAT#{updatedAt}#{chatId}` |
| `chatId` | String | UUID (for joining to chat metadata) |
| `title` | String | Denormalized for sidebar display |
| `providerId` | String | Denormalized |
| `updatedAt` | String | ISO 8601 |

This item is a separate record maintained alongside the chat metadata. It enables listing a user's chats sorted by most recently updated without a GSI.

### Why This Key Design

- **Messages as separate items** rather than a nested list on the chat item: DynamoDB items are capped at 400 KB. Long conversations would hit this quickly. Separate message items have no practical size limit and allow paginated loading.
- **User-Chat index items** avoid a GSI: a Global Secondary Index would work but adds cost and eventual consistency concerns. Maintaining a denormalized item under the `USER#` partition is simpler for this access pattern.
- **Timestamp in message SK** provides natural sort order. Including `messageId` ensures uniqueness if two messages share a timestamp.

### Capacity

- **Billing mode**: PAY_PER_REQUEST (on-demand). No capacity planning needed.
- **TTL**: Not initially enabled. Could add later for auto-deleting old chats.

---

## GraphQL Schema Changes

New types and operations added to `infrastructure/schema.graphql`:

```graphql
# --- New types ---

type ChatSummary @aws_oidc {
  chatId: String!
  title: String!
  providerId: String
  createdAt: String!
  updatedAt: String!
  messageCount: Int
}

type ChatDetail @aws_oidc {
  chatId: String!
  title: String!
  providerId: String
  createdAt: String!
  updatedAt: String!
  messages: [StoredMessage!]!
  nextToken: String
}

type StoredMessage @aws_oidc {
  messageId: String!
  role: MessageRole!
  content: String!
  timestamp: String!
  judgeRatings: AWSJSON
}

type ChatListResult @aws_oidc {
  chats: [ChatSummary!]!
  nextToken: String
}

type DeleteChatResult @aws_oidc {
  chatId: String!
  success: Boolean!
}

# --- New inputs ---

input CreateChatInput {
  chatId: String!
  title: String!
  providerId: String
}

input SaveMessageInput {
  chatId: String!
  messageId: String!
  role: MessageRole!
  content: String!
  timestamp: String!
}

input UpdateMessageInput {
  chatId: String!
  messageId: String!
  content: String
  judgeRatings: AWSJSON
  timestamp: String!
}

input UpdateChatInput {
  chatId: String!
  title: String
  providerId: String
}

# --- New queries ---
# (added to existing Query type)
  listChats(limit: Int, nextToken: String): ChatListResult!
    @aws_oidc

  getChat(chatId: String!, messageLimit: Int, messageNextToken: String): ChatDetail
    @aws_oidc

# --- New mutations ---
# (added to existing Mutation type)
  createChat(input: CreateChatInput!): ChatSummary!
    @aws_oidc

  updateChat(input: UpdateChatInput!): ChatSummary!
    @aws_oidc

  deleteChat(chatId: String!): DeleteChatResult!
    @aws_oidc

  saveMessage(input: SaveMessageInput!): StoredMessage!
    @aws_oidc

  updateMessage(input: UpdateMessageInput!): StoredMessage!
    @aws_oidc
```

### Key Points

- `AWSJSON` is an AppSync built-in scalar for arbitrary JSON. Used for `judgeRatings` to avoid modeling the deeply nested structure in GraphQL.
- `nextToken` on both `listChats` and `getChat` enables pagination. Chat list pagination for users with many chats; message pagination for long conversations.
- All new operations use `@aws_oidc` -- only authenticated users can call them.
- The user ID is **not** passed as an argument. It's extracted from the OIDC token in the resolver VTL template (`$context.identity.sub`), preventing users from accessing other users' data.

---

## AppSync Resolvers

All chat history CRUD operations use **DynamoDB direct resolvers** (VTL templates) rather than Lambda. Below are the key resolver designs.

### `listChats` Query Resolver

```vtl
## Request template
{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "PK = :pk AND begins_with(SK, :sk)",
    "expressionValues": {
      ":pk": $util.dynamodb.toDynamoDBJson("USER#${context.identity.sub}"),
      ":sk": $util.dynamodb.toDynamoDBJson("CHAT#")
    }
  },
  "scanIndexForward": false,
  "limit": $util.defaultIfNull($ctx.args.limit, 50),
  "nextToken": $util.toJson($util.defaultIfNull($ctx.args.nextToken, null))
}
```

`scanIndexForward: false` returns most recently updated chats first.

### `getChat` Query Resolver

Uses a **pipeline resolver** with two functions:
1. Fetch chat metadata (`CHAT#{chatId}` / `META`) and verify `userId` matches caller.
2. Query messages (`CHAT#{chatId}` / `MSG#*`) with pagination.

The first function provides authorization: if the chat's `userId` doesn't match `$context.identity.sub`, the resolver returns an unauthorized error.

### `createChat` Mutation Resolver

Uses `BatchPutItem` to write two items atomically:
1. Chat metadata item (`CHAT#{chatId}` / `META`)
2. User-Chat index item (`USER#{userId}` / `CHAT#{updatedAt}#{chatId}`)

Sets `userId` from `$context.identity.sub` (not from client input).

### `saveMessage` Mutation Resolver

Uses a **pipeline resolver**:
1. **Auth check**: Query the chat metadata item, verify `userId` matches caller.
2. **Write message**: `PutItem` for the message item.
3. **Update chat metadata**: Update `updatedAt` and increment `messageCount` with `UpdateItem`.
4. **Update user-chat index**: Delete old SK entry and write new one with updated timestamp.

### `updateMessage` Mutation Resolver

Used for two cases:
- Appending streamed content to an assistant message.
- Adding judge ratings after evaluation completes.

Pipeline resolver: auth check, then `UpdateItem` with `SET` expressions for the changed fields.

### `deleteChat` Mutation Resolver

Deleting a chat requires removing all associated items (metadata, all messages, user-chat index). Since DynamoDB doesn't have cascading deletes:

Option A -- **Lambda resolver for delete**: A small Lambda function that queries all items with `PK = CHAT#{chatId}` and batch-deletes them, plus removes the user-chat index item. This is the pragmatic choice since VTL can't loop over an unbounded number of items.

Option B -- **DynamoDB TTL**: Mark items as deleted and let TTL clean them up. Adds complexity to all read queries (must filter deleted items).

**Recommendation**: Option A. Add a lightweight `deleteChat` Lambda function or extend the existing infrastructure to handle this. The delete operation is infrequent and not latency-sensitive.

---

## Infrastructure Changes (Terraform)

### New Resources

```
infrastructure/
├── dynamodb.tf          # New: DynamoDB table definition
├── appsync.tf           # Modified: new data source, resolvers
├── iam.tf               # Modified: DynamoDB permissions
├── lambda.tf            # Modified: deleteChat Lambda (if Option A)
├── schema.graphql       # Modified: new types/operations
└── resolvers/           # New directory: VTL templates
    ├── listChats.req.vtl
    ├── listChats.res.vtl
    ├── getChat.meta.req.vtl
    ├── getChat.meta.res.vtl
    ├── getChat.messages.req.vtl
    ├── getChat.messages.res.vtl
    ├── createChat.req.vtl
    ├── createChat.res.vtl
    ├── saveMessage.*.vtl
    ├── updateMessage.*.vtl
    └── deleteChat.*.vtl
```

### `dynamodb.tf`

```hcl
resource "aws_dynamodb_table" "chats" {
  name         = "${var.project_name}-${var.environment}-chats"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  tags = {
    Name        = "${var.project_name}-chats"
    Environment = var.environment
  }
}
```

### IAM Changes

Add a new policy on `aws_iam_role.lambda_execution` (for the deleteChat Lambda) and a new IAM role for the AppSync DynamoDB data source:

```hcl
# AppSync DynamoDB data source role
resource "aws_iam_role" "appsync_dynamodb" {
  name = "${var.project_name}-${var.environment}-appsync-dynamodb"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "appsync.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "appsync_dynamodb_access" {
  name = "${var.project_name}-${var.environment}-appsync-dynamodb-access"
  role = aws_iam_role.appsync_dynamodb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem"
      ]
      Resource = [
        aws_dynamodb_table.chats.arn
      ]
    }]
  })
}
```

### AppSync Data Source

```hcl
resource "aws_appsync_datasource" "dynamodb_chats" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "DynamoDBChats"
  type             = "AMAZON_DYNAMODB"
  service_role_arn = aws_iam_role.appsync_dynamodb.arn

  dynamodb_config {
    table_name = aws_dynamodb_table.chats.name
    region     = var.aws_region
  }
}
```

---

## Frontend Changes

### New Service: `src/services/chatHistoryService.ts`

Replaces `src/utils/chatStorage.ts`. Exposes the same logical operations but backed by GraphQL calls:

```typescript
// Core operations
listChats(limit?: number, nextToken?: string): Promise<ChatListResult>
getChat(chatId: string): Promise<ChatDetail>
createChat(chat: CreateChatInput): Promise<ChatSummary>
updateChat(input: UpdateChatInput): Promise<ChatSummary>
deleteChat(chatId: string): Promise<void>
saveMessage(input: SaveMessageInput): Promise<StoredMessage>
updateMessage(input: UpdateMessageInput): Promise<StoredMessage>
```

### Changes to `App.tsx`

1. **Remove** `loadChats()`/`saveChats()` imports and the `useEffect` hooks that call them.
2. **On mount**: Call `listChats()` to populate the sidebar.
3. **On chat select**: Call `getChat(chatId)` to load messages (with pagination for long chats).
4. **On send message**: Call `saveMessage()` for the user message. Create the chat first via `createChat()` if it's a new conversation.
5. **On stream complete**: Call `saveMessage()` for the final assistant message content. During streaming, only React state is updated (not DynamoDB) -- the full message is saved once streaming finishes.
6. **On judge rating received**: Call `updateMessage()` to persist the rating.
7. **On delete chat**: Call `deleteChat()` instead of filtering localStorage.

### Streaming Strategy

Streaming messages should NOT write to DynamoDB on every chunk -- that would be expensive and unnecessary. The approach:

1. User message is saved to DynamoDB immediately (it's complete).
2. An empty assistant message placeholder is created in React state only.
3. As chunks stream in, only React state is updated.
4. When streaming completes (`done: true`), `saveMessage()` is called once with the full content.
5. If streaming fails, no assistant message is persisted.

This matches the current behavior where localStorage is updated via a `useEffect` on state changes, but is more efficient since it avoids writing partial content.

### Alternative: Save from Lambda

A future optimization could have the Chat Lambda save messages to DynamoDB directly. The Lambda already has the complete request (user messages) and assembles the full response. This would:
- Eliminate the need for the frontend to call `saveMessage` at all for the assistant message.
- Guarantee persistence even if the user closes the tab mid-stream.
- Require the Lambda to know the `chatId`, which would need to be passed in the `sendMessage` mutation.

This is a good Phase 2 improvement but adds complexity to the initial implementation.

---

## Authorization Model

All authorization is enforced server-side in the AppSync resolvers:

1. **User identity**: Extracted from the OIDC JWT token via `$context.identity.sub`. Never passed as a client argument.
2. **Chat ownership**: The `userId` field on chat metadata is set at creation time from the token. All read/update/delete operations verify `userId` matches the caller.
3. **No cross-user access**: There is no operation that accepts a `userId` parameter. A user can only interact with their own data.
4. **Message access**: Messages are accessed through their parent chat. If the chat ownership check passes, the user can access its messages.

### Resolver Authorization Pattern

Every resolver that accesses a specific chat (get, update, delete, save/update message) follows this pattern:

```vtl
## Step 1: Fetch chat metadata
## Step 2: Check $context.identity.sub == $chatItem.userId
## Step 3: If mismatch, $util.unauthorized()
## Step 4: Proceed with operation
```

For `listChats`, authorization is implicit: the query partition key includes the user ID, so only the caller's chats are returned.

---

## Implementation Plan

### Phase 1: Infrastructure & CRUD

1. Add DynamoDB table to Terraform (`dynamodb.tf`).
2. Add AppSync DynamoDB data source and IAM role.
3. Extend the GraphQL schema with new types and operations.
4. Write VTL resolver templates for all CRUD operations.
5. Add a `deleteChat` Lambda function.
6. Deploy and test with manual GraphQL queries.

### Phase 2: Frontend Integration

1. Create `chatHistoryService.ts` with all GraphQL operations.
2. Update `App.tsx` to use the new service instead of localStorage.
3. Add loading states for chat list and chat detail fetches.
4. Add error handling for network failures (retry with exponential backoff).
5. Add optimistic updates for a responsive UI (update state immediately, persist in background).
6. Update `ChatHistorySidebar` to support paginated loading if needed.
7. Remove `chatStorage.ts` and localStorage usage.

### Phase 3: Polish & Optimization

1. Add message pagination for long conversations (load more on scroll up).
2. Consider caching recently accessed chats in memory to reduce API calls.
3. Add offline indicator / graceful degradation if AppSync is unreachable.
4. Consider moving message persistence into the Chat Lambda (save-from-Lambda optimization).

---

## Cost Estimate

DynamoDB on-demand pricing (us-east-1):

| Operation | Cost | Notes |
|---|---|---|
| Write (1 WRU = 1 KB) | $1.25 per million | Each message save is 1-2 WRUs |
| Read (1 RRU = 4 KB) | $0.25 per million | Chat list + message load |
| Storage | $0.25 per GB/month | Text messages are small |

**Example**: A user with 100 chats averaging 50 messages each = 5,000 messages. At ~1 KB per message = ~5 MB storage. Loading all chats in a month with average usage patterns would cost fractions of a cent.

The DynamoDB cost for this feature will be negligible compared to the LLM API costs already being incurred.

---

## Alternatives Considered

### S3 (JSON files per chat)
- Pro: Simple, cheap storage.
- Con: No query capability. Can't list chats without maintaining a separate index. No atomic updates for individual messages. Higher latency. No native AppSync integration.

### Aurora Serverless (PostgreSQL)
- Pro: Full SQL, relational integrity, full-text search.
- Con: Overkill for key-value chat storage. VPC required. Cold start latency. Higher base cost. No native AppSync data source (would need Lambda resolvers for everything).

### AppSync with ElastiCache
- Con: Adds operational complexity. Cache invalidation is hard. DynamoDB is already fast enough for this access pattern.

### Keep localStorage, add sync
- Pro: Works offline.
- Con: Conflict resolution is complex. Still limited by localStorage size. Doesn't solve the core problem of server-side persistence.

---

## Open Questions

1. **Message pagination size**: What's the right default page size for messages? 50? 100? Should we load the most recent page first and support "load more" scrolling up?
2. **Chat list limit**: Should there be a max number of chats per user, or do we let it grow unbounded?
3. **Data retention**: Should old chats be auto-deleted after some period (TTL)? Or is indefinite retention acceptable?
4. **Offline behavior**: If the user loses connectivity, should we fall back to localStorage temporarily and sync when reconnected? Or just show an error state?
5. **Lambda-side persistence**: Should Phase 1 include saving messages from the Chat Lambda, or defer to Phase 3?
