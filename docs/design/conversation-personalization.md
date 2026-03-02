# Product Design: Conversation History Personalization

**Author:** AI Assistant
**Date:** 2026-03-02
**Status:** Draft

---

## 1. Problem Statement

Today, every chat session starts from zero context. The system prompt is a static string:

```
You are a helpful, friendly assistant. Be concise and clear in your responses.
```

The app already stores full conversation history in DynamoDB and has a user preferences system, but none of this data feeds back into how the LLM responds. Users who have had dozens of conversations still get generic responses with no awareness of their interests, communication style, or past topics.

Meanwhile, competing products (ChatGPT's Memory, Gemini's Gems, Copilot's personalization) extract and apply user context automatically, making their responses feel more tailored over time.

## 2. Goals

1. **Responses feel personal** — the LLM knows the user's name, profession, recurring interests, and preferred communication style without being asked each time.
2. **User control** — users can view, edit, and delete anything the system has "learned" about them. No opaque black box.
3. **Incremental cost** — personalization should add minimal latency and token overhead per request (~200-400 system prompt tokens).
4. **Provider-agnostic** — works identically across OpenAI, Anthropic, Gemini, and Grok since personalization is injected at the system prompt level.

## 3. Non-Goals

- RAG over full conversation history (semantic search across all past messages)
- Auto-generated "personas" or "agents" from user data
- Cross-user personalization or collaborative memory
- Personalizing the judge system

## 4. Design Overview

The system has three layers:

```
┌─────────────────────────────────────────────────────┐
│                    Frontend                         │
│  User Memory Panel (view/edit/delete memory items)  │
│  Toggle: "Personalization enabled"                  │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               Memory Extraction                     │
│  (async Lambda, runs after each assistant response) │
│  Reads new messages → extracts facts → deduplicates │
│  → writes to DynamoDB                               │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Memory Injection                       │
│  (chat Lambda, runs before each LLM call)           │
│  Reads user's memory items → builds personalized    │
│  system prompt → prepends to messages               │
└─────────────────────────────────────────────────────┘
```

### 4.1 Data Model — User Memory Items

Stored in the existing DynamoDB chats table using the single-table pattern:

```
PK: IUSER#{internalUserId}
SK: MEMORY#{ulid}

Attributes:
  content    : String  — the fact itself ("User is a frontend engineer at Acme Corp")
  category   : String  — one of: bio, preference, interest, instruction, project
  source     : String  — chatId where this was extracted from
  createdAt  : String  — ISO timestamp
  updatedAt  : String  — ISO timestamp
  ttl        : Number  — optional, not set by default (memories persist)
```

**Categories:**
| Category | What it captures | Example |
|---|---|---|
| `bio` | Name, role, location, company | "User's name is Sarah. She's a senior engineer at Acme." |
| `preference` | Communication/format preferences | "User prefers code examples in TypeScript." |
| `interest` | Recurring topics or hobbies | "User is interested in distributed systems and Rust." |
| `instruction` | Explicit standing instructions | "Always explain trade-offs when suggesting approaches." |
| `project` | Active projects or codebases | "User is building a React Native fitness app." |

**Why not a separate table?** The existing table already handles multi-entity single-table design (`IUSER#`, `CHAT#`, `RATELIMIT#`). Adding another entity type is consistent and avoids Terraform changes to create/manage a new table.

### 4.2 Memory Extraction (Async)

**Trigger:** After each completed assistant response, the frontend fires a new `extractMemory` GraphQL mutation with the latest user message and assistant response.

**Lambda handler (`memoryExtractor.ts`):**

1. Receives the new user+assistant message pair, plus the user's existing memory items (fetched from DynamoDB).
2. Calls a lightweight LLM (e.g., `claude-haiku-4-5-20251001` or `gpt-4o-mini`) with a structured extraction prompt:

```
You are a memory extraction system. Given a conversation exchange and the user's
existing memories, extract new facts about the user that would be useful for
personalizing future responses.

Rules:
- Only extract facts the USER explicitly stated or clearly implied about themselves.
- Do NOT extract facts about topics discussed — only about the user as a person.
- Do NOT extract anything from the assistant's responses.
- If a new fact contradicts an existing memory, output an UPDATE for that memory.
- If a fact is already captured, output nothing.
- Be conservative: when in doubt, don't extract.

Existing memories:
{existing_memories_json}

New exchange:
User: {user_message}
Assistant: {assistant_message}

Output JSON array (empty array if nothing to extract):
[
  { "action": "add", "content": "...", "category": "bio|preference|interest|instruction|project" },
  { "action": "update", "id": "existing_memory_ulid", "content": "updated fact" },
]
```

3. Parses the JSON response, writes new items / updates existing items in DynamoDB.

**Why async and not inline?** Extraction adds 1-3 seconds of LLM call time. Running it synchronously would delay the user's next message. Since memory doesn't need to be available until the *next* conversation, async is fine.

**Cost:** ~200-500 tokens per extraction call using a small model. At $0.25/1M input tokens (Haiku), this is roughly $0.0001 per message — negligible.

### 4.3 Memory Injection (Synchronous)

**Where:** In the chat Lambda handler (`chat.ts` → `initAndStream`), before calling the LLM provider.

**How:**

1. After resolving the internal user ID and passing rate limit checks, query DynamoDB for the user's memory items:
   ```
   PK = IUSER#{internalUserId}, SK begins_with MEMORY#
   ```
2. If personalization is enabled and memory items exist, build a personalized system prompt section and prepend it to the messages array as a system message.

**Personalized system prompt template:**

```
You are a helpful, friendly assistant. Be concise and clear in your responses.

The following is context about the user you're chatting with. Use it naturally to
personalize your responses — don't explicitly reference that you "remember" things
unless the user asks. If any context seems outdated or contradicted by the current
conversation, prioritize what the user says now.

About the user:
- Sarah, senior frontend engineer at Acme Corp
- Prefers TypeScript with strict mode
- Working on a React Native fitness tracking app
- Interested in distributed systems and Rust
- Wants trade-offs explained when choosing between approaches
```

**Token budget:** Cap injected memory at ~300 tokens. If the user accumulates more memories than fit, prioritize by category (instructions > bio > project > preference > interest) and recency.

### 4.4 User Memory Panel (Frontend)

A new section in the app (accessible from a sidebar menu item or settings) where users can:

1. **View** all memory items, grouped by category
2. **Edit** any item's text inline
3. **Delete** individual items
4. **Add** manual items (effectively "standing instructions")
5. **Toggle** personalization on/off globally (stored in existing user preferences)

This requires three new GraphQL operations:

```graphql
type MemoryItem {
  id: ID!
  content: String!
  category: String!
  createdAt: String!
  updatedAt: String!
}

type Query {
  listMemoryItems: [MemoryItem!]!
}

type Mutation {
  updateMemoryItem(input: UpdateMemoryItemInput!): MemoryItem!
  deleteMemoryItem(id: ID!): Boolean!
  addMemoryItem(input: AddMemoryItemInput!): MemoryItem!
}
```

## 5. Implementation Plan

### Phase 1: Memory Storage + Manual Management (Backend)

**Files changed:**
- `infrastructure/lambda/src/memory.ts` — new: DynamoDB CRUD for memory items
- `infrastructure/lambda/src/index.ts` — export new handlers
- `infrastructure/schema.graphql` — add MemoryItem type and operations
- `infrastructure/lambda.tf` — wire new Lambda handlers
- `infrastructure/resolvers/` — new VTL resolvers for memory operations

**What it delivers:** Users can manually add, view, edit, and delete memory items via GraphQL. No extraction yet — this validates the data model and API.

### Phase 2: Memory Injection into Chat

**Files changed:**
- `infrastructure/lambda/src/chat.ts` — read memory items before LLM call, build personalized system prompt
- `src/App.tsx` — pass personalization toggle from user preferences
- `src/services/appsyncChat.ts` — include personalization flag in the mutation input

**What it delivers:** Memory items (manually added in Phase 1) now influence LLM responses. This is the core value — even without auto-extraction, power users who add their own context will see personalized responses.

### Phase 3: Automatic Memory Extraction

**Files changed:**
- `infrastructure/lambda/src/memoryExtractor.ts` — new: extraction Lambda
- `infrastructure/schema.graphql` — add `extractMemory` mutation
- `infrastructure/lambda.tf` — new Lambda for extraction
- `src/App.tsx` — fire extraction mutation after each completed response

**What it delivers:** Memories are automatically extracted from conversations. The system learns about users over time without manual effort.

### Phase 4: Frontend Memory Panel

**Files changed:**
- `src/components/MemoryPanel.tsx` — new: memory management UI
- `src/services/memoryService.ts` — new: GraphQL client for memory CRUD
- `src/App.tsx` — add route/drawer for Memory Panel
- `src/contexts/UserPreferencesContext.tsx` — personalization toggle already supported via generic preferences

**What it delivers:** Users can see what the system knows about them and have full control over it.

## 6. Privacy and Safety

| Concern | Mitigation |
|---|---|
| Users unaware of what's stored | Memory Panel makes all items visible and editable |
| Sensitive info extracted (health, finances) | Extraction prompt explicitly excludes sensitive categories; review and tune over time |
| Memory injection as prompt injection vector | Memory items are system-prompt-level only, prepended by the backend — users cannot inject arbitrary system instructions through memory (extraction LLM controls what gets stored) |
| GDPR / data deletion | Deleting a memory item removes it from DynamoDB. Account deletion should cascade to all `IUSER#` items (already the pattern for preferences) |
| Personalization toggle | Global off-switch in user preferences. When off, no memory is injected and no extraction runs |

## 7. Token and Cost Impact

| Component | Per-message cost | Notes |
|---|---|---|
| Memory injection | ~300 extra input tokens | Adds ~$0.001 per message (Sonnet-tier pricing) |
| Memory extraction | ~400 tokens (small model) | ~$0.0001 per message (Haiku-tier pricing) |
| DynamoDB reads | 1 Query per chat message | Negligible at pay-per-request pricing |
| DynamoDB writes | ~0.1 writes per message (most messages don't produce new memories) | Negligible |

**Total incremental cost:** ~$0.001 per message, or roughly 5-10% increase on typical usage.

## 8. Alternatives Considered

**Full RAG over conversation history:** Embedding all past messages and doing vector similarity search per query. Much more powerful but requires a vector database (e.g., OpenSearch, Pinecone), adds significant latency (200-500ms), and dramatically increases complexity. The extracted-facts approach gets 80% of the value at 10% of the cost. Can be added later as a complement.

**Client-side memory only (localStorage):** Simpler but doesn't work across devices, is lost on browser clear, and puts extraction compute on the client. Server-side is the right choice for a multi-device app.

**LLM-managed memory (let the model decide in-context):** Some approaches pass a `<memory>` block in every conversation and ask the LLM to update it as part of its response. This couples memory management to the chat response, increases output token costs, and makes the quality of memory dependent on which provider is used. Decoupled extraction is more reliable.

## 9. Future Extensions

- **Conversation-scoped memory:** "Remember for this chat only" items that persist within a session but don't propagate globally.
- **Memory decay:** Automatically reduce relevance of old, unused memories over time.
- **Semantic search over history:** Layer RAG on top of the extracted facts for cases where exact recall of past conversations matters ("What did I ask about Redis last week?").
- **Provider-specific tuning:** Different providers may benefit from different memory formatting (e.g., Anthropic's system prompt handling vs. OpenAI's).
- **Memory sharing:** Let users export/import memory profiles, or share memory templates.

## 10. Open Questions

1. **Memory item cap per user** — Should we enforce a maximum number of memory items (e.g., 100)? This bounds the system prompt token cost and prevents unbounded growth.
2. **Extraction frequency** — Should we extract from every message pair, or only when the conversation reaches a certain length or topic depth?
3. **Which model for extraction** — Haiku is cheapest, but may miss nuance. Should we offer a quality dial, or just pick one?
4. **Incognito mode interaction** — The app already has an incognito/ephemeral chat mode. Should extraction be automatically disabled for incognito chats? (Probably yes.)
