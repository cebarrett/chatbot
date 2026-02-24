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

- The Nano Banana image generation backend (`streamGeminiImage`) — no changes
- Image storage in S3 with presigned URLs
- `ContentBlock` type, `ImageGallery`, `ImageCard`, `ImageLightbox` components
- The chunk streaming protocol (image chunks as JSON in the `chunk` field)
- DynamoDB persistence of `contentBlocks`
- Incognito mode handling for images

### Out of Scope

- **Multi-turn image editing** — follow-up messages that reference/modify prior images (Phase 2)
- **User-uploaded images** — sending images as input to LLMs (Phase 3)
- **OpenAI image generation** — this phase consolidates on Nano Banana only; GPT Image 1.5 can be re-added later as a user preference
- **Image options UI** — size/quality selection (can be added later as a settings panel)

## 2. Intent Detection

### 2.1 Approach: Two-Stage Classification in Lambda

Intent detection runs server-side in the Lambda handler, before provider routing. This ensures consistent behavior regardless of client and prevents the frontend from needing to understand routing logic.

The classifier uses a **two-stage approach** to avoid adding latency to non-image requests:

**Stage 1 — Keyword pre-filter (synchronous, ~0ms):**
A regex check on the last user message for image-related keywords. If no keywords match, skip classification entirely and route to the text provider. This is the fast path for the vast majority of messages.

```typescript
const IMAGE_INTENT_PATTERNS = [
  /\b(generate|create|make|draw|paint|sketch|design|render|produce)\b.*\b(image|picture|photo|illustration|artwork|portrait|poster|icon|logo|diagram|infographic|comic|meme|wallpaper|banner|thumbnail|avatar|scene|landscape)\b/i,
  /\b(image|picture|photo|illustration|artwork|portrait|poster|icon|logo|diagram)\b.*\b(of|showing|depicting|featuring|with)\b/i,
  /\b(show me|visualize|illustrate|depict)\b/i,
  /\b(dall-?e|stable diffusion|midjourney|image gen)\b/i,
];

function hasImageKeywords(message: string): boolean {
  return IMAGE_INTENT_PATTERNS.some(pattern => pattern.test(message));
}
```

**Stage 2 — LLM verification (async, ~200–400ms):**
When keywords are detected, use a lightweight Gemini model to verify the intent. This eliminates false positives from the keyword filter (e.g., "Can you explain how image generation works?" matches keywords but is not an image request).

```typescript
const CLASSIFIER_MODEL = 'gemini-2.0-flash-lite';
const CLASSIFIER_PROMPT = `You are a binary classifier. Does the following user message request that you generate, create, or draw an image or picture? Answer only "yes" or "no".

User message: """
{MESSAGE}
"""`;
```

The classifier uses `gemini-2.0-flash-lite` — the fastest and cheapest Gemini model (~$0.00002 per classification). The same `GEMINI_API_KEY` already in Secrets Manager is used, so no new secrets are needed.

### 2.2 Classification Examples

| User message | Stage 1 (keywords) | Stage 2 (LLM) | Result |
|---|---|---|---|
| "What is photosynthesis?" | No match | Skipped | Text provider |
| "Generate an image of a sunset over the ocean" | Match | "yes" | Nano Banana |
| "How does image generation work?" | Match | "no" | Text provider |
| "Draw me a cat wearing a top hat" | Match | "yes" | Nano Banana |
| "Show me the code for a REST API" | Match | "no" | Text provider |
| "Create a picture of a futuristic city" | Match | "yes" | Nano Banana |
| "Can you make an image processing pipeline?" | Match | "no" | Text provider |
| "I want a logo for my startup" | Match | "yes" | Nano Banana |

### 2.3 Edge Cases and Failure Modes

- **Classifier timeout/error**: If the LLM classification fails (network error, model error), fall through to the text provider. The user gets a text response — wrong but safe. No image cost is incurred. The error is logged for monitoring.
- **Ambiguous prompts**: "Show me a sunset" could be interpreted as "find me a photo" or "generate an image." The LLM classifier handles this better than keywords alone. When in doubt, the classifier should lean toward "no" to avoid unexpected image generation costs.
- **Cost of false positives**: An incorrectly classified image generation costs ~$0.04 (Nano Banana) versus ~$0.002 for a text response. The two-stage approach minimizes this risk.
- **Multilingual support**: The keyword filter is English-only for Phase 1. The LLM classifier handles multilingual prompts naturally. Non-English image requests that bypass keyword patterns will be routed to text. This is an acceptable limitation for Phase 1.

## 3. Architecture Changes

### 3.1 Request Flow (Before)

```
User selects "Gemini Image" provider → Frontend sends provider: GEMINI_IMAGE
→ Lambda routes to streamGeminiImage() → Image response
```

### 3.2 Request Flow (After)

```
User has "Claude" selected → sends "Draw me a cat" → Frontend sends provider: ANTHROPIC
→ Lambda keyword pre-filter: match → LLM classifier: "yes"
→ Lambda routes to streamGeminiImage() instead of streamAnthropic()
→ Image response streamed back through same subscription
→ Frontend parses image content blocks from response
```

```
User has "Claude" selected → sends "What is recursion?" → Frontend sends provider: ANTHROPIC
→ Lambda keyword pre-filter: no match
→ Lambda routes to streamAnthropic() (normal text flow)
→ Text response streamed back
```

### 3.3 Data Flow Diagram

```
┌──────────┐  sendMessage        ┌──────────────────┐
│ Frontend │  provider: ANTHROPIC│     Lambda        │
│          │ ───────────────────→ │                  │
│          │  "Draw a cat in     │  ┌─────────────┐ │
│          │   a spacesuit"      │  │ Keyword      │ │
│          │                     │  │ Pre-filter   │ │
│          │                     │  └──────┬───────┘ │
│          │                     │    match │         │
│          │                     │  ┌──────▼───────┐ │
│          │                     │  │ LLM Classify │ │  Gemini Flash Lite
│          │                     │  │ (Flash Lite) │──────→ "yes"
│          │                     │  └──────┬───────┘ │
│          │                     │   image │ intent   │
│          │                     │  ┌──────▼───────┐ │     ┌─────────────┐
│          │   publishChunk      │  │ Nano Banana  │──────→│ Gemini API  │
│          │ ←───────────────────│  │ (Image Gen)  │←──────│ (Image)     │
│          │  chunk: {type:image}│  └──────────────┘ │     └─────────────┘
│          │                     │                   │
│          │  parseImageStream   │   Upload to S3    │
│          │  → contentBlocks    │   → presigned URL │
└──────────┘                     └───────────────────┘
```

## 4. Implementation Plan

### 4.1 Lambda: Intent Classifier Module

**New file:** `infrastructure/lambda/src/intentClassifier.ts`

```typescript
const IMAGE_INTENT_PATTERNS = [
  /\b(generate|create|make|draw|paint|sketch|design|render|produce)\b.*\b(image|picture|photo|illustration|artwork|portrait|poster|icon|logo|diagram|infographic|comic|meme|wallpaper|banner|thumbnail|avatar|scene|landscape)\b/i,
  /\b(image|picture|photo|illustration|artwork|portrait|poster|icon|logo|diagram)\b.*\b(of|showing|depicting|featuring|with)\b/i,
  /\b(show me|visualize|illustrate|depict)\b/i,
  /\b(dall-?e|stable diffusion|midjourney|image gen)\b/i,
];

const CLASSIFIER_MODEL = 'gemini-2.0-flash-lite';
const CLASSIFIER_TIMEOUT_MS = 3000;

export interface IntentResult {
  intent: 'text' | 'image';
  confidence: 'keyword_miss' | 'llm_confirmed' | 'llm_denied' | 'llm_error';
}

/**
 * Determine whether the user's message is requesting image generation.
 * Two-stage: fast keyword pre-filter, then LLM verification.
 */
export async function classifyIntent(
  message: string,
  geminiApiKey: string,
): Promise<IntentResult> {
  // Stage 1: keyword pre-filter
  const hasKeywords = IMAGE_INTENT_PATTERNS.some(p => p.test(message));
  if (!hasKeywords) {
    return { intent: 'text', confidence: 'keyword_miss' };
  }

  // Stage 2: LLM verification
  try {
    const response = await classifyWithLLM(message, geminiApiKey);
    if (response === 'yes') {
      return { intent: 'image', confidence: 'llm_confirmed' };
    }
    return { intent: 'text', confidence: 'llm_denied' };
  } catch (error) {
    console.error('Intent classification failed, defaulting to text:', error);
    return { intent: 'text', confidence: 'llm_error' };
  }
}

async function classifyWithLLM(
  message: string,
  apiKey: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CLASSIFIER_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a binary classifier. Does the following user message request that you generate, create, or draw an image or picture? Answer only "yes" or "no".\n\nUser message: """\n${message}\n"""`,
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
    let effectiveProvider = provider;
    if (provider !== 'GEMINI_IMAGE' && provider !== 'OPENAI_IMAGE') {
      const intent = await classifyIntent(lastUserMessage, secrets.GEMINI_API_KEY);
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
        tokenCount = await streamGeminiImage(secrets.GEMINI_API_KEY, lastUserMessage, requestId, userId, requestId);
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

### 4.3 Frontend: Remove Image Providers from Registry and Dropdown

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

### 4.4 Frontend: Always Parse for Image Content

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

### 4.5 Frontend: Judge Handling

**File changed:** `src/App.tsx`

Judges should be skipped when the response contains images. Update the judge condition:

```typescript
// BEFORE:
if (enabledJudges.length > 0 && !wasCancelled && finalResponse.trim() && !isImageProvider) {

// AFTER:
const hasImageContent = contentBlocks?.some(b => b.type === 'image') ?? false;
if (enabledJudges.length > 0 && !wasCancelled && finalResponse.trim() && !hasImageContent) {
```

### 4.6 Frontend: Typing Indicator

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

### 4.7 GraphQL Schema: No Changes Required

The `ChatProvider` enum retains `GEMINI_IMAGE` and `OPENAI_IMAGE` for backward compatibility (existing chats reference them). The frontend simply stops sending these values for new requests. The Lambda still handles them in the switch statement for any in-flight or retried requests.

No new fields are needed on `SendMessageInput` or `SendMessageResponse`.

### 4.8 Validation: No Changes Required

`validation.ts` continues to accept `GEMINI_IMAGE` and `OPENAI_IMAGE` as valid providers. The frontend will stop sending them, but they remain valid for backward compatibility.

## 5. Files Changed Summary

| File | Change |
|---|---|
| `infrastructure/lambda/src/intentClassifier.ts` | **New** — two-stage intent classification (keyword + LLM) |
| `infrastructure/lambda/src/chat.ts` | Add intent classification before provider routing |
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
- `streamGeminiImage` provider implementation
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
| Keyword pre-filter | $0 (regex, in-process) | Every message |
| LLM classification (Flash Lite) | ~$0.00002 per call | Only when keywords match (~5-15% of messages) |
| Image generation (Nano Banana) | ~$0.04 per image | Only when classified as image intent |

The classification cost is negligible. The main cost impact is that image generation now happens automatically when users ask for it, rather than requiring explicit provider selection. This could increase image generation volume if users discover they can request images from any provider selection. The existing rate limiter (token budget) provides cost control.

## 8. Testing

### Intent Classifier Unit Tests

```typescript
// intentClassifier.test.ts
describe('hasImageKeywords', () => {
  it('matches explicit image requests', () => {
    expect(hasImageKeywords('Generate an image of a sunset')).toBe(true);
    expect(hasImageKeywords('Draw me a cat')).toBe(true);
    expect(hasImageKeywords('Create a picture of a mountain')).toBe(true);
  });

  it('does not match non-image requests', () => {
    expect(hasImageKeywords('What is the capital of France?')).toBe(false);
    expect(hasImageKeywords('Write me a poem')).toBe(false);
    expect(hasImageKeywords('Explain quantum computing')).toBe(false);
  });

  it('matches despite case differences', () => {
    expect(hasImageKeywords('GENERATE AN IMAGE of a dog')).toBe(true);
  });
});

describe('classifyIntent', () => {
  it('returns text for non-image messages without calling LLM', async () => {
    const result = await classifyIntent('Hello world', 'fake-key');
    expect(result).toEqual({ intent: 'text', confidence: 'keyword_miss' });
    // Verify no HTTP call was made
  });

  it('calls LLM for keyword matches and respects response', async () => {
    // Mock Gemini API to return "yes"
    const result = await classifyIntent('Generate an image of a cat', mockKey);
    expect(result).toEqual({ intent: 'image', confidence: 'llm_confirmed' });
  });

  it('falls back to text on LLM error', async () => {
    // Mock Gemini API to throw
    const result = await classifyIntent('Draw me a picture', mockKey);
    expect(result).toEqual({ intent: 'text', confidence: 'llm_error' });
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

## 9. Alternatives Considered

### Alternative A: Frontend-Side Intent Detection

Detect image intent in the frontend before sending to Lambda. The frontend would set a flag or override the provider to `GEMINI_IMAGE`.

**Rejected.** Client-side detection can be bypassed or inconsistent across clients. Moving detection to Lambda keeps the routing logic centralized and authoritative. It also means the frontend doesn't need to know about the image generation provider at all.

### Alternative B: Rule-Based Only (No LLM Classifier)

Use keyword/regex matching alone without LLM verification.

**Rejected.** Pure keyword matching has too many false positives ("explain image processing", "create an image pipeline in Python"). The LLM verification step costs ~$0.00002 and eliminates the most damaging failure mode (unexpected $0.04 image generation when the user wanted text).

### Alternative C: LLM Classification on Every Message (No Keyword Pre-Filter)

Run the Gemini Flash Lite classifier on every message.

**Rejected.** Adds 200-400ms latency to every request, including the ~85-95% that are clearly text. The keyword pre-filter provides a fast path for non-image messages at the cost of potentially missing unusual phrasings — an acceptable tradeoff since false negatives just produce a text response.

### Alternative D: Let the Text Provider Decide

Send all messages to the selected text provider with instructions to output a special `[GENERATE_IMAGE: prompt]` tag when the user wants an image. Lambda parses the response and triggers image generation.

**Rejected.** This adds a full LLM round-trip before image generation begins, roughly doubling latency. It also requires prompt engineering across five different text providers and is fragile — any provider could generate the tag incorrectly or fail to use it.

### Alternative E: User-Facing Toggle (Image Mode Button)

Add an "Image mode" toggle button near the chat input, instead of auto-detection.

**Rejected for Phase 1.** This is a UX regression from what users expect after ChatGPT/Gemini app/etc., where you simply ask for an image in natural language. The toggle approach is essentially what we have today with the provider dropdown, just with different UI chrome. Auto-detection is the user-expected behavior.

## 10. Future Work

1. **Multi-turn image editing** — send previous images back to Nano Banana with modification prompts ("make the background blue", "add a hat")
2. **User image uploads** — allow users to attach images to messages for vision/multimodal LLM input
3. **Provider preference for image generation** — user setting to choose between Nano Banana and GPT Image 1.5 for auto-routed image requests
4. **Inline image options** — size and quality controls that appear when image intent is detected (before generation starts)
5. **Streaming status update** — detect image intent from early chunks and update the typing indicator to "Generating image..." mid-stream
6. **Multilingual keyword patterns** — extend the pre-filter to support common non-English image request phrasings
7. **Intent classification metrics** — log classification results to monitor false positive/negative rates and tune the keyword patterns
