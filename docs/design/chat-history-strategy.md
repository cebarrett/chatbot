# Chat History & Personalization Strategy

**Date:** 2026-03-03
**Status:** Draft

## 1. Overview

Define a privacy-first personalization strategy for the chatbot. Today, each chat is a fully isolated conversation — the LLM receives no context from other chats, no user profile data, and a generic system prompt. This is a strong privacy posture but leaves personalization on the table. Rather than choosing one or the other, this design introduces a tiered opt-in system where privacy is the default and personalization is an explicit, transparent, user-controlled upgrade.

## 2. Goals

- Establish privacy-first defaults as a brand differentiator, not a limitation.
- Give users who want personalization a clear, opt-in path with full visibility into what data is shared.
- Avoid silent inference — the app never guesses or infers personal context without the user's knowledge.
- Every piece of context sent to an LLM is user-visible and user-editable at all times.
- Build incrementally: each tier is independently valuable and can ship separately.

## 3. Non-Goals

- Training on user data. No user content is ever used to fine-tune or train models.
- Automatic profiling. The app does not build hidden user profiles from conversation patterns.
- Cross-user personalization. One user's data never influences another user's experience.
- Changing the existing incognito mode. Incognito chats remain fully ephemeral.

## 4. Current State

| Aspect | Today |
|--------|-------|
| In-chat context | Full conversation history within the current chat is sent to the LLM |
| Cross-chat context | None — each chat is completely independent |
| System prompt | Hardcoded: "You are a helpful, friendly assistant. Be concise and clear in your responses." |
| User preferences | Stored in DynamoDB, but used only for frontend UI state (theme, onboarding). Never sent to LLMs |
| User profile data | Internal user ID exists for rate limiting. Not sent to providers |
| Incognito mode | Skips DynamoDB persistence entirely; messages exist only in memory |
| Judge/reviewer context | Receives current chat history for evaluation, not for personalization |

## 5. Tiered Personalization Model

### 5.1 Tier 0: No Personalization (Default — Current Behavior)

Each chat is isolated. The LLM sees only the system prompt and the current conversation. No cross-chat memory, no user profile injection.

**This is the default for all users and remains available at all times.**

This tier is actively marketed as a feature:

- "Your conversations stay yours. No memory. No training. No profiling."
- Position against competitors who default to data collection and opt-out privacy.
- Appeals to: privacy-conscious users, enterprise/professional use, anyone handling sensitive information (legal, medical, financial), AI skeptics who distrust opaque personalization.

**Changes required:** None to the technical system. Messaging, marketing, and onboarding copy changes only.

### 5.2 Tier 1: Custom Instructions (User-Declared Context)

Users explicitly tell the app about themselves and how they want responses. This context is injected into the system prompt on every message. The user writes it, the user controls it, the user can see exactly what is sent.

**What the user configures:**

- **Custom instructions** — Free-text field where users describe themselves, their work, or how they want the AI to respond. Examples:
  - "I'm a Python developer working on data pipelines."
  - "I'm a high school teacher. Explain things simply."
  - "I prefer concise answers with code examples."
- **Response style** — Structured selector for common preferences:
  - Concise / Balanced / Detailed
  - Technical / Non-technical
  - Formal / Casual

**How it works:**

```
┌──────────────────────────────────────────────────────┐
│ System prompt (assembled at Lambda layer)             │
│                                                       │
│ Base:  "You are a helpful, friendly assistant..."     │
│                                                       │
│ + Custom instructions (if set):                       │
│   "The user has provided the following context        │
│    about themselves and their preferences:            │
│    {customInstructions}"                              │
│                                                       │
│ + Response style (if set):                            │
│   "The user prefers {concise/detailed} responses      │
│    in a {formal/casual}, {technical/non-technical}    │
│    style."                                            │
└──────────────────────────────────────────────────────┘
```

**Key properties:**

- The user explicitly writes or selects everything. No inference.
- Instructions are visible in a settings panel and editable at any time.
- A "preview" shows the exact system prompt text that will be sent.
- Instructions apply to all future chats but can be overridden per-chat.
- Stored in the existing `userPreferences` DynamoDB structure.

**Why this tier first:** It delivers immediate personalization value with minimal technical complexity. The infrastructure already exists — `userPreferences` is already stored in DynamoDB with localStorage caching. The only new work is adding fields to the preferences schema and injecting them into the system prompt at the Lambda layer.

### 5.3 Tier 2: Chat Summaries (Opt-In Memory)

When a user finishes a chat, they can choose to save a short summary of key facts and decisions from that conversation. These summaries — never raw transcripts — are available as optional context in future chats.

**How it works:**

1. At the end of a chat (or on demand), the user can click "Save summary."
2. The app generates a brief summary of the conversation's key points using the same LLM provider. The summary is generated client-side or with an explicit server-side call — the user sees and approves it before saving.
3. The user can edit the summary before saving, remove specific items, or discard it entirely.
4. Saved summaries appear in a "Memory" panel in settings where users can view, edit, search, and delete any entry.
5. When starting a new chat, if the user has saved summaries, relevant ones are included in the system prompt context (with a configurable limit on how many).

**Summary format:**

```
{
  "chatId": "abc-123",
  "createdAt": "2026-03-03T10:30:00Z",
  "title": "Python data pipeline architecture",
  "facts": [
    "User is building an ETL pipeline using Apache Airflow",
    "Database is PostgreSQL 16 on RDS",
    "Prefers pandas over polars for familiarity"
  ],
  "approved": true
}
```

**Key properties:**

- Summaries are never generated silently — always user-initiated and user-approved.
- Raw conversation content is never stored as memory. Only distilled facts.
- Users see which summaries are active and can disable/delete any of them.
- Summaries have a token budget (e.g., max 500 tokens total injected into system prompt) to avoid bloating context windows.
- Relevance selection can be simple at first (most recent N summaries) and later upgraded to semantic search.

**Storage:** New DynamoDB items under the user's partition: `PK: "IUSER#{userId}"`, `SK: "MEMORY#{summaryId}"`.

### 5.4 Tier 3: Conversation Memory (Full Opt-In)

Full cross-chat retrieval — the app can reference and search across past conversations to inform new ones. This is the most personalized tier and the least private. It is clearly labeled as such.

**How it works:**

1. User explicitly enables "Conversation Memory" in settings.
2. A clear disclosure explains: "When enabled, the AI can reference your past conversations to give more relevant responses. Your conversation history is indexed and searched when you start new chats."
3. Past messages are indexed (vector embeddings stored in a vector store or DynamoDB with embeddings).
4. When the user sends a message, a retrieval step finds the most relevant past exchanges and includes them as context.
5. The context inspector (see Section 6) shows exactly which past messages were retrieved and included.

**Key properties:**

- Disabled by default. Requires explicit opt-in with a clear explanation.
- Can be turned off at any time — disabling removes the index but does not delete chat history.
- Individual chats can be excluded from indexing.
- Incognito chats are never indexed regardless of this setting.
- Retrieved context is always shown to the user (no hidden retrieval).

**Deferred:** This tier requires significant infrastructure (vector store, embedding pipeline, retrieval logic) and should be built only after Tiers 1 and 2 are validated with users.

## 6. Context Inspector

A transparency feature available at all personalization tiers. A small toggle or expandable panel in the chat UI that shows the user exactly what context accompanies their messages.

**What it shows:**

- The full system prompt (base + custom instructions + response style)
- Active chat summaries being included (Tier 2)
- Retrieved past messages being included (Tier 3)
- Token count of the total context

**UI treatment:**

- A subtle icon (e.g., eye or info icon) in the chat input area or header.
- Clicking opens a slide-out panel or modal showing the assembled context.
- Read-only in the inspector; editable in settings.
- Available even at Tier 0 so users can see the base system prompt.

**Why this matters:** Transparency builds trust. Users who can see exactly what the AI knows about them are more comfortable with personalization and more likely to opt in. It also aligns with the app's core value proposition of helping users understand how AI works.

## 7. Personalized Evaluation (Judge/Reviewer Integration)

An alternative path to personalization that does not require sharing personal data with LLM providers. Instead of personalizing the prompt, personalize the evaluation.

**How it works:**

- Users configure what they care about in AI responses: accuracy, brevity, code quality, creativity, reading level, etc.
- These preferences are passed to the reviewer system, which weights its evaluation accordingly.
- A user who values brevity sees lower scores for verbose responses. A user who values thoroughness sees lower scores for terse ones.
- The reviewer prompt is extended with user evaluation preferences:

```
"The user has indicated they particularly value: {evaluationPreferences}.
Weight your scoring to reflect these priorities."
```

**Key properties:**

- Evaluation preferences are separate from custom instructions — they affect how responses are judged, not how they are generated.
- This gives users a sense of personalization without the LLM provider knowing anything about them.
- Works at any tier, including Tier 0.

## 8. Architecture

### 8.1 System Prompt Assembly

Move system prompt construction from the frontend to the Lambda layer. Today, the frontend sends the system prompt as part of the message array. With personalization, the Lambda should assemble the final prompt:

```
Frontend sends:
  - messages[]
  - provider
  - chatId

Lambda assembles:
  1. Base system prompt (hardcoded)
  2. + Custom instructions (from user preferences in DynamoDB)
  3. + Response style (from user preferences in DynamoDB)
  4. + Active summaries (from DynamoDB, Tier 2)
  5. + Retrieved context (from vector store, Tier 3)
  6. = Final system prompt sent to LLM provider
```

**Why move to the Lambda:** Custom instructions and summaries are stored server-side. Assembling the prompt on the backend avoids sending preference data to the frontend just to send it back to the backend. It also prevents client-side tampering with the system prompt.

### 8.2 Data Model Changes

**User preferences (existing table, extended schema):**

```typescript
interface UserPreferences {
  // Existing fields
  onboarding_completed: boolean

  // Tier 1: Custom instructions
  custom_instructions?: string        // Free-text, max 2000 chars
  response_style?: {
    verbosity: 'concise' | 'balanced' | 'detailed'
    technicality: 'technical' | 'non-technical'
    tone: 'formal' | 'casual'
  }

  // Evaluation preferences (Section 7)
  evaluation_priorities?: string[]    // e.g., ['accuracy', 'brevity', 'code_quality']

  // Tier 3: Conversation memory
  conversation_memory_enabled?: boolean
}
```

**Chat summaries (new items in existing table):**

```
PK: "IUSER#{internalUserId}"
SK: "MEMORY#{summaryId}"

Attributes:
  summaryId: string (UUID)
  chatId: string
  title: string
  facts: string[] (list of fact strings)
  createdAt: string (ISO 8601)
  tokenCount: number
  active: boolean
```

### 8.3 API Changes

**New/modified GraphQL operations:**

```graphql
# Tier 1: Custom instructions (extend existing preferences)
input UpdateUserPreferencesInput {
  # ... existing fields ...
  customInstructions: String
  responseStyle: ResponseStyleInput
  evaluationPriorities: [String!]
  conversationMemoryEnabled: Boolean
}

# Tier 2: Chat summaries
type ChatSummary @aws_oidc {
  summaryId: String!
  chatId: String!
  title: String!
  facts: [String!]!
  createdAt: String!
  tokenCount: Int!
  active: Boolean!
}

input GenerateSummaryInput {
  chatId: String!
}

input SaveSummaryInput {
  chatId: String!
  title: String!
  facts: [String!]!
}

type Query {
  listSummaries: [ChatSummary!]! @aws_oidc
}

type Mutation {
  generateSummary(input: GenerateSummaryInput!): ChatSummary! @aws_oidc
  saveSummary(input: SaveSummaryInput!): ChatSummary! @aws_oidc
  deleteSummary(summaryId: String!): Boolean! @aws_oidc
  toggleSummary(summaryId: String!, active: Boolean!): ChatSummary! @aws_oidc
}
```

### 8.4 Privacy Controls Flow

```
User opens Settings → Personalization
    │
    ├── Custom Instructions ─────── [text area, always visible]
    │     └── Preview: "This is what the AI sees about you"
    │
    ├── Response Style ──────────── [dropdowns: verbosity, technicality, tone]
    │
    ├── Evaluation Priorities ───── [checkboxes: accuracy, brevity, etc.]
    │
    ├── Chat Summaries ──────────── [toggle: off by default]
    │     ├── Saved Summaries ────── [list with view/edit/delete per item]
    │     └── Active count / token budget indicator
    │
    ├── Conversation Memory ─────── [toggle: off by default]
    │     └── Disclosure text explaining what this means
    │
    └── Context Inspector ───────── [link: "See what the AI knows about you"]
          └── Shows assembled system prompt preview
```

## 9. Onboarding Integration

The existing onboarding flow (PRD Section P0.1) should introduce the personalization tiers:

- During onboarding, briefly mention: "By default, each conversation starts fresh. The AI doesn't remember previous chats. You can change this in Settings if you want."
- Do not push users toward personalization during onboarding. The default (Tier 0) is the right starting point for the target audience.
- After users have had several conversations, a non-intrusive prompt can suggest custom instructions: "Tip: You can tell the AI about yourself in Settings → Personalization to get more relevant responses."

## 10. Messaging & Positioning

### For Privacy-Conscious Users (Tier 0)

- "Your conversations stay yours. No memory. No training. No profiling. Unless you choose otherwise."
- "Every chat starts fresh — the AI knows nothing about you except what you tell it in this conversation."
- "Unlike other AI apps, we don't default to collecting your data and make you opt out. We default to privacy and let you opt in to personalization."

### For Users Who Want Personalization (Tiers 1-3)

- "Tell the AI about yourself, in your own words, and see exactly what it knows."
- "Save what matters, forget the rest. You control your AI's memory."
- "Every piece of context is visible, editable, and deletable. No hidden profiles."

### Competitive Positioning

| Feature | This App | ChatGPT | Claude | Gemini |
|---------|----------|---------|--------|--------|
| Default personalization | Off | On | On | On |
| User-visible context | Full transparency | Partial (memory view) | Limited | Limited |
| User-editable memory | Full control | Partial | No | No |
| Cross-chat memory | Opt-in only | Default on | Default on | Default on |
| Training on chats | Never | Opt-out | Opt-out | Opt-out |
| Context inspector | Yes | No | No | No |

## 11. Implementation Phases

### Phase 1: Tier 1 + Context Inspector

**Estimated scope:** Small. Extends existing infrastructure.

- Add `customInstructions`, `responseStyle` fields to user preferences schema
- Build settings UI for custom instructions and response style
- Move system prompt assembly to the Lambda layer
- Build context inspector panel
- Update onboarding to mention personalization settings

**Dependencies:** None beyond existing infrastructure.

### Phase 2: Personalized Evaluation

**Estimated scope:** Small. Extends existing reviewer system.

- Add `evaluationPriorities` to user preferences
- Build UI for selecting evaluation priorities
- Extend judge system prompt with user priorities
- Pass priorities through existing judge Lambda

**Dependencies:** Phase 1 (for the settings UI framework).

### Phase 3: Tier 2 — Chat Summaries

**Estimated scope:** Medium. New data model and UI.

- New DynamoDB items for summaries
- Summary generation logic (LLM call to distill chat into facts)
- Summary management UI (list, view, edit, delete, toggle)
- System prompt injection of active summaries with token budgeting
- New GraphQL operations for summary CRUD

**Dependencies:** Phase 1 (system prompt assembly in Lambda).

### Phase 4: Tier 3 — Conversation Memory

**Estimated scope:** Large. New infrastructure required.

- Vector store setup (e.g., OpenSearch Serverless, Pinecone, or pgvector)
- Embedding pipeline for chat messages
- Retrieval logic integrated into chat Lambda
- UI for memory management and chat exclusion
- Context inspector updates to show retrieved passages

**Dependencies:** Phase 3, plus new infrastructure decisions.

## 12. Security Considerations

- **Custom instructions** are user-provided free text injected into system prompts. They must be treated as untrusted input. The existing prompt injection protections in the judge system (XML escaping, instruction separation) should be applied here as well. Custom instructions should be placed in a clearly delimited section of the system prompt.
- **Chat summaries** are LLM-generated and user-approved, but still treated as untrusted when injected into prompts.
- **Conversation memory** retrieval results are injected into prompts and must be sandboxed from the system instructions.
- **Context inspector** must be read-only — it shows what is sent but does not allow inline editing of the system prompt.
- **Data deletion** must be thorough. When a user deletes custom instructions, summaries, or disables conversation memory, the data is removed from DynamoDB (and any vector store) promptly.
- **Incognito mode** remains fully ephemeral at all tiers. Incognito chats are never summarized, indexed, or referenced.

## 13. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Tier 1 adoption | 30% of active users set custom instructions within 30 days | DynamoDB preference field population rate |
| Context inspector usage | 15% of users open it at least once | Frontend analytics event |
| Tier 2 adoption | 10% of Tier 1 users save at least one summary within 60 days | DynamoDB summary count |
| Privacy messaging impact | Positive sentiment in user feedback about privacy | Qualitative feedback |
| Reviewer personalization | Users who set evaluation priorities engage with reviewer ratings 20% more than those who don't | Rating expansion / follow-up event rate |

## 14. Open Questions

1. **Token budget for summaries:** How many tokens of summary context should be injected? Too few limits usefulness; too many crowds out conversation history. Starting point: 500 tokens, configurable per user.
2. **Summary relevance:** For Tier 2, should all active summaries be included, or should the app attempt to select relevant ones based on the current conversation topic? Simple (all active) is easier to explain and more predictable. Semantic selection is more useful but harder to make transparent.
3. **Per-chat custom instructions:** Should users be able to override their global custom instructions for a specific chat? This adds flexibility but also UI complexity.
4. **Provider-specific instructions:** Some instructions may be provider-specific (e.g., "Use Claude's extended thinking for complex questions"). Should the app support per-provider custom instructions, or is one global set sufficient?
5. **Evaluation priority weights:** Should evaluation priorities be simple checkboxes (equally weighted) or should users be able to rank/weight them? Start simple (checkboxes), add weighting later if users request it.
