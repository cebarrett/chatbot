# Design: Multimodal Chat — Phase 1 (Automatic Image Generation)

## 1. Overview

Replace the explicit image provider selection model with automatic image generation routing. When a user sends a prompt that requests an image, the system detects the intent and generates the image using Nano Banana (Gemini Image) — regardless of which text provider is selected. The user never needs to manually switch to an image provider.

This is the first phase of multimodal chat threads, implementing item #4 from the [image generation design](./design-image-generation.md#10-future-work): *"auto-detect image generation intent from prompt text and route to the image provider without requiring manual provider selection."*

### What Changes

1. **Remove image providers from the provider dropdown** — users only see text LLMs (Claude, Gemini, ChatGPT, Grok, Perplexity)
2. **Add intent detection in Lambda** — classify each user message to determine if it's an image generation request
3. **Route image requests to Nano Banana** — when intent is detected, generate the image via `streamGeminiImage()` instead of the selected text provider
4. **Adapt the frontend** — always attempt to parse image content from responses, removing the assumption that only explicit image providers produce images

### What Stays the Same

- Image storage in S3 with presigned URLs
- `ContentBlock` type, `ImageGallery`, `ImageCard`, `ImageLightbox` components
- The chunk streaming protocol (image chunks as JSON in the `chunk` field)
- DynamoDB persistence of `contentBlocks`
- Incognito mode handling for images

### Out of Scope

- **Multi-turn image editing with visual context** — passing previous images back to Nano Banana as `inlineData` for true editing ("make the background red"). Phase 1 passes text-only conversation history, which supports follow-up generation but not visual editing. See [Section 2.6](#26-conversation-context-for-image-generation) for the full breakdown.
- **Thought signature persistence** — storing and replaying Gemini's thought signatures for multi-turn `inlineData` conversations (required for Phase 2)
- **User-uploaded images** — sending images as input to LLMs (Phase 3)
- **OpenAI image generation** — this phase consolidates on Nano Banana only; GPT Image 1.5 can be re-added later as a user preference
- **Image options UI** — size/quality selection (can be added later as a settings panel)

## 2. Intent Detection

### 2.1 Approach: LLM Classification on Every Message

Intent detection runs server-side in the Lambda handler, before provider routing. This ensures consistent behavior regardless of client and prevents the frontend from needing to understand routing logic.

Every user message is classified by `gemini-2.0-flash-lite` — the fastest and cheapest Gemini model. A single-token yes/no response determines whether the message is an image generation request. This approach was chosen over a regex keyword pre-filter because:

- **Language-agnostic** — works for any language without maintaining locale-specific patterns
- **Robust to phrasing** — handles creative, indirect, or colloquial requests ("I want something that looks like a Monet of my backyard")
- **Zero maintenance** — no regex patterns to curate, test, or update as new phrasings emerge
- **Negligible cost** — ~$0.00002 per classification, or ~$0.60 per 30,000 messages/month

The same `GEMINI_API_KEY` already in Secrets Manager is used, so no new secrets are needed.

```typescript
const CLASSIFIER_MODEL = 'gemini-2.0-flash-lite';
const CLASSIFIER_TIMEOUT_MS = 3000;

const CLASSIFIER_PROMPT = `You are a binary classifier. Given the conversation history and the latest user message, is the user requesting that an image be generated, created, drawn, or that a previous image be modified? Answer only "yes" or "no".

Conversation:
{HISTORY}

Answer:`;
```

### 2.2 Latency

Flash Lite classification adds ~200–400ms to every request. This is acceptable because:

- The classification runs *before* the main LLM call, so total latency is `classify + generate`, not doubled
- 200-400ms is within the range of normal network jitter users already experience
- The main LLM response (text or image) takes 1–15 seconds, so the classification overhead is <10% of perceived latency in all cases

### 2.3 Classification Examples

| User message | Classification | Result |
|---|---|---|
| "What is photosynthesis?" | "no" | Text provider |
| "Generate an image of a sunset over the ocean" | "yes" | Nano Banana |
| "How does image generation work?" | "no" | Text provider |
| "Draw me a cat wearing a top hat" | "yes" | Nano Banana |
| "Show me the code for a REST API" | "no" | Text provider |
| "Create a picture of a futuristic city" | "yes" | Nano Banana |
| "Can you make an image processing pipeline?" | "no" | Text provider |
| "I want a logo for my startup" | "yes" | Nano Banana |
| "Dessine-moi un chat" (French: "Draw me a cat") | "yes" | Nano Banana |
| "画一只猫" (Chinese: "Draw a cat") | "yes" | Nano Banana |

### 2.4 Edge Cases and Failure Modes

- **Classifier timeout/error**: If the LLM classification fails (network error, model error, 3-second timeout), fall through to the text provider. The user gets a text response — wrong but safe. No image cost is incurred. The error is logged for monitoring.
- **Ambiguous prompts**: "Show me a sunset" could be interpreted as "find me a photo" or "generate an image." The classifier prompt instructs it to identify explicit generation requests. When in doubt, it should lean toward "no" to avoid unexpected image generation costs.
- **Cost of false positives**: An incorrectly classified image generation costs ~$0.04 (Nano Banana) versus ~$0.002 for a text response. The classifier's precision is critical; the prompt is tuned to minimize false positives.

### 2.5 Conversation Context for Classification

The classifier needs conversation history, not just the latest message. Without it, follow-up requests like "now do one of a goose" (after "generate a photo of a duck in impressionist style") would be classified as text — there are no image-related keywords in isolation.

The classifier receives a condensed summary of recent conversation turns. Assistant messages that produced images are represented as `[Generated N image(s)]` to signal prior image context without sending actual image data to the classifier:

```typescript
const CLASSIFIER_PROMPT = `You are a binary classifier. Given the conversation history and the latest user message, is the user requesting that an image be generated, created, drawn, or that a previous image be modified? Answer only "yes" or "no".

Conversation:
{HISTORY}

Answer:`;

// Example history passed to classifier:
// User: Generate a photo of a duck in impressionist style
// Assistant: [Generated 1 image]
// User: Now do one of a goose
```

The history is capped at the **last 6 messages** (3 exchanges) to keep the classifier prompt small and fast. This is sufficient to capture the conversational context for follow-up requests while keeping token costs minimal.

| Follow-up message | Without history | With history |
|---|---|---|
| "Now do one of a goose" | "no" (wrong) | "yes" (correct) |
| "Make it more blue" | "no" (wrong) | "yes" (correct) |
| "Same style but a sunset" | "no" (wrong) | "yes" (correct) |
| "What breed is that?" | "no" (correct) | "no" (correct) |

## 2.6 Conversation Context for Image Generation

### How Nano Banana Handles Multi-Turn

The Gemini `generateContent` API fully supports multi-turn image conversations. The `contents` array accepts alternating `user`/`model` turns, where each turn's `parts` can contain both text and images (`inlineData` with base64). The model uses the full conversation history to understand context, style, and subject continuity.

A multi-turn image generation request looks like:

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Generate a photo of a duck in impressionist style" }]
    },
    {
      "role": "model",
      "parts": [
        { "text": "Here's an impressionist-style duck." },
        { "inlineData": { "mimeType": "image/png", "data": "<base64>" } }
      ]
    },
    {
      "role": "user",
      "parts": [{ "text": "Now do one of a goose" }]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

### Two Levels of Context

There are two levels of conversation context we can provide to Nano Banana, with different trade-offs:

**Level 1 — Text-only context (Phase 1):**
Pass previous messages as text, substituting `[Generated N image(s)]` for image content. The model gets conversational context (subjects, styles, instructions) but no visual reference to previous images.

```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "Generate a photo of a duck in impressionist style" }] },
    { "role": "model", "parts": [{ "text": "[Generated 1 image]" }] },
    { "role": "user", "parts": [{ "text": "Now do one of a goose" }] }
  ]
}
```

This is sufficient for:
- Follow-up generation with same style/theme ("now do a goose", "same but with a sunset")
- Changing subjects while maintaining context ("make the next one a landscape")
- Continuing a theme ("generate another one")

This is **not sufficient** for:
- Visual editing ("make the background red", "remove the hat")
- Style transfer from a specific generated image ("in exactly the same composition")

**Level 2 — Full multimodal context (Phase 2):**
Pass previous generated images as `inlineData` (base64) in the `model` turns. The model sees both text and visual history, enabling true image editing and visual consistency.

This requires:
- Fetching previous images from S3 and converting to base64
- Managing the 20MB request size limit (each image is ~1-4MB base64)
- Handling thought signatures (see below)
- History truncation to keep within limits

### Phase 1 Approach: Text-Only Context

Phase 1 implements Level 1 (text-only context). This is the right starting point because:

1. **It handles the core use case** — follow-up generation requests like "now do one of a goose" work correctly because the model understands the conversational context
2. **No S3 fetching required** — the Lambda doesn't need to download previous images, avoiding latency and complexity
3. **No request size concerns** — text-only history is tiny compared to the 20MB limit
4. **No thought signature management** — thought signatures are required when passing back `inlineData` from `gemini-3-pro-image-preview` model responses (see below), adding significant state management complexity
5. **Clear upgrade path** — Level 2 is an additive change on top of Level 1, not a rewrite

### Thought Signatures (Phase 2 Concern)

The current model (`gemini-3-pro-image-preview`) returns **thought signatures** — opaque tokens attached to each response part. When passing model responses back in multi-turn history, these signatures must be included exactly as received. Omitting them causes a 400 error.

```json
// Model response with thought signatures
{
  "role": "model",
  "parts": [
    { "text": "Here's your duck.", "thoughtSignature": "abc123..." },
    { "inlineData": { "mimeType": "image/png", "data": "<base64>" }, "thoughtSignature": "def456..." }
  ]
}
```

For Phase 1 (text-only context), thought signatures are not needed — we're not passing back model response parts, just a text summary. For Phase 2, thought signatures would need to be stored alongside `contentBlocks` in DynamoDB and passed back in the `contents` array. This is a significant addition to the persistence model and is one of the reasons Phase 2 is a separate effort.

### Constraints for Phase 2

When Phase 2 adds full multimodal context, these limits apply:

| Constraint | Limit | Impact |
|---|---|---|
| Inline request size | 20MB total | ~5-15 images depending on resolution |
| Token budget | Model context window | Each image: 258 tokens (≤384px) to 258×N tokens (tiled at 768px) |
| Latency | Increases with images | Each image adds ~200-500ms to request processing |

A truncation strategy will be needed: keep the last N images and drop older ones from history, retaining their text summaries.

## 3. Architecture Changes

### 3.1 Request Flow (Before)

```
User selects "Gemini Image" provider → Frontend sends provider: GEMINI_IMAGE
→ Lambda routes to streamGeminiImage() → Image response
```

### 3.2 Request Flow (After)

```
User has "Claude" selected → sends "Draw me a cat" → Frontend sends provider: ANTHROPIC
→ Lambda classifies with Flash Lite: "yes"
→ Lambda routes to streamGeminiImage() instead of streamAnthropic()
→ Image response streamed back through same subscription
→ Frontend parses image content blocks from response
```

```
User has "Claude" selected → sends "What is recursion?" → Frontend sends provider: ANTHROPIC
→ Lambda classifies with Flash Lite: "no"
→ Lambda routes to streamAnthropic() (normal text flow)
→ Text response streamed back
```

### 3.3 Data Flow Diagram

```
┌──────────┐  sendMessage        ┌───────────────────┐
│ Frontend │  provider: ANTHROPIC│     Lambda         │
│          │ ───────────────────→ │                   │
│          │  "Draw a cat in     │  ┌──────────────┐  │
│          │   a spacesuit"      │  │ Flash Lite   │  │   Gemini Flash Lite
│          │                     │  │ Classifier   │──────→ "yes"
│          │                     │  └──────┬───────┘  │
│          │                     │   image │ intent    │
│          │                     │  ┌──────▼───────┐  │     ┌─────────────┐
│          │   publishChunk      │  │ Nano Banana  │──────→ │ Gemini API  │
│          │ ←───────────────────│  │ (Image Gen)  │←────── │ (Image)     │
│          │  chunk: {type:image}│  └──────────────┘  │     └─────────────┘
│          │                     │                    │
│          │  parseImageStream   │   Upload to S3     │
│          │  → contentBlocks    │   → presigned URL  │
└──────────┘                     └────────────────────┘
```

## 4. Implementation Plan

### 4.1 Lambda: Intent Classifier Module

**New file:** `infrastructure/lambda/src/intentClassifier.ts`

```typescript
import { ChatMessageInput } from './types';

const CLASSIFIER_MODEL = 'gemini-2.0-flash-lite';
const CLASSIFIER_TIMEOUT_MS = 3000;
const MAX_HISTORY_MESSAGES = 6; // Last 3 exchanges

export interface IntentResult {
  intent: 'text' | 'image';
  confidence: 'llm_confirmed' | 'llm_denied' | 'llm_error';
}

/**
 * Classify whether the user's message is requesting image generation.
 * Uses Gemini Flash Lite for a single-token yes/no classification.
 * Includes recent conversation history for context (e.g., follow-up requests).
 * Falls back to 'text' on any error to avoid unexpected image costs.
 */
export async function classifyIntent(
  messages: ChatMessageInput[],
  geminiApiKey: string,
): Promise<IntentResult> {
  try {
    const answer = await classifyWithLLM(messages, geminiApiKey);
    return answer === 'yes'
      ? { intent: 'image', confidence: 'llm_confirmed' }
      : { intent: 'text', confidence: 'llm_denied' };
  } catch (error) {
    console.error('Intent classification failed, defaulting to text:', error);
    return { intent: 'text', confidence: 'llm_error' };
  }
}

/**
 * Build a condensed conversation summary for the classifier prompt.
 * Image responses are represented as "[Generated N image(s)]" so
 * the classifier understands prior image context without needing
 * the actual image data.
 */
function buildHistorySummary(messages: ChatMessageInput[]): string {
  // Take the last N messages (skip system messages)
  const recent = messages
    .filter(m => m.role !== 'system')
    .slice(-MAX_HISTORY_MESSAGES);

  return recent
    .map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${m.content}`;
    })
    .join('\n');
}

async function classifyWithLLM(
  messages: ChatMessageInput[],
  apiKey: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
  const history = buildHistorySummary(messages);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CLASSIFIER_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a binary classifier. Given the conversation history and the latest user message, is the user requesting that an image be generated, created, drawn, or that a previous image be modified? Answer only "yes" or "no".\n\nConversation:\n${history}\n\nAnswer:`,
          }],
        }],
        generationConfig: {
          maxOutputTokens: 3,
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
    return text === 'yes' ? 'yes' : 'no';
  } finally {
    clearTimeout(timeout);
  }
}
```

### 4.2 Lambda: Chat Handler Routing Changes

**File changed:** `infrastructure/lambda/src/chat.ts`

The `streamInBackground` function gains an intent classification step before the provider switch:

```typescript
import { classifyIntent } from './intentClassifier';

async function streamInBackground(
  secrets: LLMSecrets,
  provider: ChatProvider,
  messages: ChatMessageInput[],
  requestId: string,
  userId: string,
  internalUserId: string,
  model?: string,
  imageSize?: string,
  imageQuality?: string,
): Promise<void> {
  try {
    let tokenCount = 0;
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Intent classification: check if this is an image generation request
    // Pass full messages array so classifier has conversation context
    let effectiveProvider = provider;
    if (provider !== 'GEMINI_IMAGE' && provider !== 'OPENAI_IMAGE') {
      const intent = await classifyIntent(messages, secrets.GEMINI_API_KEY);
      console.log(`Intent classification: ${intent.intent} (${intent.confidence}) for provider ${provider}`);
      if (intent.intent === 'image') {
        effectiveProvider = 'GEMINI_IMAGE';
      }
    }

    switch (effectiveProvider) {
      case 'OPENAI':
        tokenCount = await streamOpenAI(secrets.OPENAI_API_KEY, messages, requestId, userId, model);
        break;
      // ... other text providers unchanged ...
      case 'GEMINI_IMAGE':
        // Pass full messages array for conversation context (text-only in Phase 1)
        tokenCount = await streamGeminiImage(secrets.GEMINI_API_KEY, messages, requestId, userId, requestId);
        break;
      // OPENAI_IMAGE case retained for backward compatibility with existing chats
      case 'OPENAI_IMAGE':
        tokenCount = await streamOpenAIImage(secrets.OPENAI_API_KEY, lastUserMessage, requestId, userId, requestId, { size: imageSize, quality: imageQuality });
        break;
      default:
        throw new Error(`Unknown provider: ${effectiveProvider}`);
    }

    await recordTokenUsage(internalUserId, tokenCount);
  } catch (error) {
    // ... error handling unchanged ...
  }
}
```

### 4.3 Lambda: `streamGeminiImage` with Conversation Context

**File changed:** `infrastructure/lambda/src/providers/geminiImage.ts`

The function signature changes from taking a `prompt` string to taking the full `messages` array. It builds Gemini's `contents` array with text-only conversation history, giving the model context for follow-up requests.

```typescript
import { ChatMessageInput } from '../types';

/**
 * Build the Gemini contents array from conversation history.
 * Phase 1: text-only context. Assistant messages that contained images
 * are represented by their text content (e.g., "[Generated 1 image]").
 * Phase 2 will add inlineData for previous images.
 */
function buildContents(messages: ChatMessageInput[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue; // Gemini doesn't use system messages for image gen

    const role = msg.role === 'assistant' ? 'model' : 'user';

    // Merge consecutive same-role messages (Gemini requires alternating roles)
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: msg.content });
    } else {
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  return contents;
}

export async function streamGeminiImage(
  apiKey: string,
  messages: ChatMessageInput[],
  requestId: string,
  userId: string,
  chatId: string,
): Promise<number> {
  const batcher = new ChunkBatcher(requestId, userId);

  try {
    const contents = buildContents(messages);

    const requestBody = {
      contents,
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    };

    // ... rest of the function unchanged (API call, response parsing,
    //     S3 upload, chunk publishing) ...
  }
}
```

**Why text-only context works for Phase 1:**

When the user sends "Generate a duck in impressionist style" → [image] → "Now do one of a goose", the model receives:

```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "Generate a photo of a duck in impressionist style" }] },
    { "role": "model", "parts": [{ "text": "[Generated 1 image]" }] },
    { "role": "user", "parts": [{ "text": "Now do one of a goose" }] }
  ]
}
```

The model understands from the text history that it should generate a goose in impressionist style. It doesn't need to *see* the duck image to generate a new goose — the style/subject context is carried by the text.

**What this doesn't support** (deferred to Phase 2):
- "Make the background red" — needs the previous image as visual reference
- "Keep the same composition but change the subject" — needs visual reference
- Any editing or modification of a specific generated image

### 4.5 Frontend: Remove Image Providers from Registry and Dropdown

**File changed:** `src/services/chatProviderRegistry.ts`

Remove the `gemini-image` and `openai-image` entries from `chatProviderRegistry`. Remove or keep `IMAGE_PROVIDER_IDS` — it's still useful for rendering logic when loading old chats that have `providerId: 'gemini-image'`.

```typescript
export const chatProviderRegistry: ChatProviderConfig[] = [
  // Claude, Gemini, ChatGPT, Grok, Perplexity — unchanged
  // gemini-image and openai-image entries REMOVED
];

// Keep for backward compatibility with existing chats stored with image provider IDs
export const IMAGE_PROVIDER_IDS = new Set(['gemini-image', 'openai-image']);
```

**File changed:** `src/components/ProviderSelector.tsx`

Remove the "Image Models" section. The component only shows text providers:

```typescript
// Before: two sections ("Chat LLMs" and "Image Models")
// After: single flat list of providers (all are text LLMs)
```

Since image providers are no longer in the registry, the filtering logic that splits providers into two groups can be removed entirely.

### 4.6 Frontend: Always Parse for Image Content

**File changed:** `src/App.tsx`

The critical change: after receiving a response, always attempt to parse image content blocks — not just when the active provider is an image provider.

```typescript
// BEFORE (lines 803-838):
const isImageProvider = IMAGE_PROVIDER_IDS.has(currentProviderId);
if (isImageProvider && finalResponse) {
  contentBlocks = parseImageStreamContent(finalResponse);
  // ...
}

// AFTER:
if (finalResponse) {
  const parsed = parseImageStreamContent(finalResponse);
  const hasImages = parsed.some(b => b.type === 'image');
  if (hasImages) {
    contentBlocks = parsed;
    // Build plain-text summary for content field
    const textSummary = contentBlocks
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ');
    const imageCount = contentBlocks.filter(b => b.type === 'image').length;
    const contentForStorage = textSummary || `[Generated ${imageCount} image${imageCount > 1 ? 's' : ''}]`;

    // Update bot message with contentBlocks
    setChats(prev => prev.map(chat => {
      if (chat.id === chatIdForStream) {
        return {
          ...chat,
          messages: chat.messages.map(msg =>
            msg.id === botMessageId
              ? { ...msg, content: contentForStorage, contentBlocks }
              : msg
          ),
        };
      }
      return chat;
    }));

    finalResponse = contentForStorage;
  }
}
```

This is safe for text-only responses: `parseImageStreamContent` returns a single text block when there are no image JSON objects in the content, and `hasImages` will be false, so the existing text rendering path is used unchanged.

### 4.7 Frontend: Judge Handling

**File changed:** `src/App.tsx`

Judges should be skipped when the response contains images. Update the judge condition:

```typescript
// BEFORE:
if (enabledJudges.length > 0 && !wasCancelled && finalResponse.trim() && !isImageProvider) {

// AFTER:
const hasImageContent = contentBlocks?.some(b => b.type === 'image') ?? false;
if (enabledJudges.length > 0 && !wasCancelled && finalResponse.trim() && !hasImageContent) {
```

### 4.8 Frontend: Typing Indicator

**File changed:** `src/App.tsx`

The "Generating image..." status text can no longer be determined from the provider ID, since the text provider is selected but an image may be generated. Two options:

**Option A (simple):** Always show "Typing..." — the user will see the image appear when it's ready. This is what ChatGPT does.

**Option B (responsive):** Show "Typing..." initially, then switch to "Generating image..." when the first chunk is detected as an image JSON block. This requires minor state tracking.

**Recommendation:** Option A for Phase 1. The image will appear in the message area regardless of the status text, and the "Typing..." label is not misleading — the assistant is producing a response.

```typescript
// BEFORE:
{IMAGE_PROVIDER_IDS.has(activeProviderId) ? 'Generating image...' : 'Typing...'}

// AFTER:
{'Typing...'}
```

### 4.9 GraphQL Schema: No Changes Required

The `ChatProvider` enum retains `GEMINI_IMAGE` and `OPENAI_IMAGE` for backward compatibility (existing chats reference them). The frontend simply stops sending these values for new requests. The Lambda still handles them in the switch statement for any in-flight or retried requests.

No new fields are needed on `SendMessageInput` or `SendMessageResponse`.

### 4.10 Validation: No Changes Required

`validation.ts` continues to accept `GEMINI_IMAGE` and `OPENAI_IMAGE` as valid providers. The frontend will stop sending them, but they remain valid for backward compatibility.

## 5. Files Changed Summary

| File | Change |
|---|---|
| `infrastructure/lambda/src/intentClassifier.ts` | **New** — LLM-based intent classification via Gemini Flash Lite, accepts full message history |
| `infrastructure/lambda/src/chat.ts` | Add intent classification before provider routing; pass messages to `streamGeminiImage` |
| `infrastructure/lambda/src/providers/geminiImage.ts` | Accept `messages` array instead of `prompt` string; build multi-turn `contents` with text-only history |
| `src/services/chatProviderRegistry.ts` | Remove `gemini-image` and `openai-image` entries |
| `src/components/ProviderSelector.tsx` | Remove "Image Models" section, render flat provider list |
| `src/App.tsx` | Always parse for image content; update judge condition; simplify typing indicator |
| `src/services/appsyncChat.ts` | Remove `gemini-image` / `openai-image` cases from `mapProviderToEnum` (optional cleanup) |

**No changes to:**
- GraphQL schema
- DynamoDB schema
- S3 storage
- Image rendering components (`ChatMessage`, `ImageGallery`, `ImageCard`, `ImageLightbox`)
- `parseImageStreamContent` function
- Validation logic

## 6. Backward Compatibility

### Existing Chats with Image Provider IDs

Chats stored in DynamoDB may have `providerId: 'gemini-image'` or `providerId: 'openai-image'`. When loading these chats:

- The `IMAGE_PROVIDER_IDS` set remains in the codebase for detecting legacy image-provider chats
- `ChatMessage` rendering already checks `contentBlocks` for images, which is provider-agnostic
- The provider selector shows "Unknown" or falls back gracefully for provider IDs not in the registry

### In-Flight Requests

If a user had the old frontend open with an image provider selected, their `sendMessage` mutation with `provider: GEMINI_IMAGE` still works — the Lambda switch statement retains the case. The intent classifier is only invoked for text providers.

## 7. Cost Impact

| Component | Cost | Frequency |
|---|---|---|
| LLM classification (Flash Lite) | ~$0.00005 per call (higher with history context) | Every message |
| Image generation (Nano Banana) | ~$0.04 per image | Only when classified as image intent |

At 1,000 messages/day, classification costs ~$0.05/day ($1.50/month) — negligible compared to text and image generation costs. The cost per classification is slightly higher than a single-message classifier because the prompt includes conversation history (last 6 messages), but remains well under $0.0001 per call. The main cost impact is that image generation now happens automatically when users ask for it, rather than requiring explicit provider selection. This could increase image generation volume if users discover they can request images from any provider selection. The existing rate limiter (token budget) provides cost control.

## 8. Testing

### Intent Classifier Unit Tests

```typescript
// intentClassifier.test.ts
describe('classifyIntent', () => {
  it('classifies image generation requests as image intent', async () => {
    // Mock Gemini API to return "yes"
    const messages = [{ role: 'user', content: 'Generate an image of a cat' }];
    const result = await classifyIntent(messages, mockKey);
    expect(result).toEqual({ intent: 'image', confidence: 'llm_confirmed' });
  });

  it('classifies text questions as text intent', async () => {
    // Mock Gemini API to return "no"
    const messages = [{ role: 'user', content: 'What is the capital of France?' }];
    const result = await classifyIntent(messages, mockKey);
    expect(result).toEqual({ intent: 'text', confidence: 'llm_denied' });
  });

  it('classifies follow-up image requests using conversation context', async () => {
    // Mock Gemini API to return "yes"
    const messages = [
      { role: 'user', content: 'Generate a photo of a duck in impressionist style' },
      { role: 'assistant', content: '[Generated 1 image]' },
      { role: 'user', content: 'Now do one of a goose' },
    ];
    const result = await classifyIntent(messages, mockKey);
    expect(result).toEqual({ intent: 'image', confidence: 'llm_confirmed' });
  });

  it('falls back to text on LLM error', async () => {
    // Mock Gemini API to throw
    const messages = [{ role: 'user', content: 'Draw me a picture' }];
    const result = await classifyIntent(messages, mockKey);
    expect(result).toEqual({ intent: 'text', confidence: 'llm_error' });
  });

  it('falls back to text on timeout', async () => {
    // Mock Gemini API to hang beyond CLASSIFIER_TIMEOUT_MS
    const messages = [{ role: 'user', content: 'Draw a landscape' }];
    const result = await classifyIntent(messages, mockKey);
    expect(result).toEqual({ intent: 'text', confidence: 'llm_error' });
  });
});

describe('buildContents (geminiImage)', () => {
  it('converts messages to Gemini contents format', () => {
    const messages = [
      { role: 'user', content: 'Generate a duck' },
      { role: 'assistant', content: '[Generated 1 image]' },
      { role: 'user', content: 'Now a goose' },
    ];
    const contents = buildContents(messages);
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Generate a duck' }] },
      { role: 'model', parts: [{ text: '[Generated 1 image]' }] },
      { role: 'user', parts: [{ text: 'Now a goose' }] },
    ]);
  });

  it('skips system messages', () => {
    const messages = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Draw a cat' },
    ];
    const contents = buildContents(messages);
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Draw a cat' }] },
    ]);
  });

  it('merges consecutive same-role messages', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Draw a cat' },
    ];
    const contents = buildContents(messages);
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }, { text: 'Draw a cat' }] },
    ]);
  });
});
```

### Frontend Tests

- Verify image providers no longer appear in the provider selector
- Verify that `parseImageStreamContent` is called for all responses
- Verify that judge evaluation is skipped when response contains image blocks
- Verify that existing chats with `providerId: 'gemini-image'` render correctly

### Integration Tests

- Send a message with `provider: ANTHROPIC` and content "Draw me a cat" — verify image response is returned
- Send a message with `provider: ANTHROPIC` and content "Explain recursion" — verify text response is returned
- Send a message with `provider: ANTHROPIC` and content "How does image generation work?" — verify text response (false positive prevention)
- Send a follow-up message "Now do one of a dog" after a previous image generation — verify the follow-up is classified as image intent and generates an image
- Send a follow-up message "What breed is that?" after a previous image generation — verify it's classified as text intent

## 9. Alternatives Considered

### Alternative A: Frontend-Side Intent Detection

Detect image intent in the frontend before sending to Lambda. The frontend would set a flag or override the provider to `GEMINI_IMAGE`.

**Rejected.** Client-side detection can be bypassed or inconsistent across clients. Moving detection to Lambda keeps the routing logic centralized and authoritative. It also means the frontend doesn't need to know about the image generation provider at all.

### Alternative B: Rule-Based Only (Regex Keyword Matching)

Use keyword/regex matching alone without LLM verification.

**Rejected.** Pure keyword matching has too many false positives ("explain image processing", "create an image pipeline in Python") and is English-only. Supporting additional languages requires maintaining locale-specific pattern sets — a growing maintenance burden. The LLM classifier handles all languages natively and distinguishes genuine image requests from keyword coincidences.

### Alternative C: Two-Stage Approach (Keyword Pre-Filter + LLM Verification)

Use a regex keyword pre-filter as a fast path: only invoke the LLM classifier when keywords match.

**Rejected.** The keyword pre-filter is English-only and would silently drop non-English image requests (e.g., "Dessine-moi un chat", "画一只猫"). The cost savings are marginal (~$0.00002 per skipped classification) and not worth the localization gap or the maintenance burden of curating regex patterns.

### Alternative D: Let the Text Provider Decide

Send all messages to the selected text provider with instructions to output a special `[GENERATE_IMAGE: prompt]` tag when the user wants an image. Lambda parses the response and triggers image generation.

**Rejected.** This adds a full LLM round-trip before image generation begins, roughly doubling latency. It also requires prompt engineering across five different text providers and is fragile — any provider could generate the tag incorrectly or fail to use it.

### Alternative E: User-Facing Toggle (Image Mode Button)

Add an "Image mode" toggle button near the chat input, instead of auto-detection.

**Rejected for Phase 1.** This is a UX regression from what users expect after ChatGPT/Gemini app/etc., where you simply ask for an image in natural language. The toggle approach is essentially what we have today with the provider dropdown, just with different UI chrome. Auto-detection is the user-expected behavior.

## 10. Future Work

1. **Multi-turn image editing with visual context (Phase 2)** — pass previous generated images back to Nano Banana as `inlineData` in the `contents` array, enabling true editing ("make the background red", "keep the same composition"). Requires: S3 image fetching in Lambda, base64 encoding, thought signature storage in DynamoDB, history truncation strategy for the 20MB request limit. See [Section 2.6](#26-conversation-context-for-image-generation).
2. **User image uploads** — allow users to attach images to messages for vision/multimodal LLM input
3. **Provider preference for image generation** — user setting to choose between Nano Banana and GPT Image 1.5 for auto-routed image requests
4. **Inline image options** — size and quality controls that appear when image intent is detected (before generation starts)
5. **Streaming status update** — detect image intent from early chunks and update the typing indicator to "Generating image..." mid-stream
6. **Intent classification metrics** — log classification results to monitor false positive/negative rates and tune the classifier prompt
