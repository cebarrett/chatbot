# Design: Image Generation Feature

## 1. Overview

Add image generation capabilities to the chatbot so users can generate images via natural language prompts within the existing chat interface. Images are generated server-side by LLM provider APIs and delivered to the frontend as inline content within assistant messages.

## 2. Provider Selection

### Recommended: Multi-provider, starting with Gemini (Nano Banana Pro)

The app already integrates five LLM providers for text. Rather than picking just one image provider, we should support image generation through the providers that offer it, starting with the two that are already in the system and have strong image APIs:

| Provider | Model | Strengths | Cost/image |
|---|---|---|---|
| **Google Gemini** | Nano Banana Pro (`gemini-3-pro-image`) | Best photorealism, search grounding, few-shot consistency, thinking-before-generating | ~$0.04 (standard) |
| **OpenAI** | GPT Image 1.5 (`gpt-image-1.5`) | Best text rendering in images, highest LM Arena score, streaming support | ~$0.04–$0.17 |

**Why start with Gemini / Nano Banana Pro:** The user's instinct here is sound. Nano Banana Pro is the strongest value proposition for a chatbot context — it produces excellent photorealistic output, it's cost-competitive, and crucially it uses the same `generateContent` API the app already calls for Gemini text streaming. This means the Lambda provider at `infrastructure/lambda/src/providers/gemini.ts` needs relatively modest changes compared to integrating a brand-new service. Its "thinking" capability (reasoning about the prompt before generating) also pairs well with the existing thinking-block UI.

GPT Image 1.5 is a strong second provider. It has the best text-in-image rendering (logos, signs, labels) and uses the familiar OpenAI API surface already implemented in `providers/openai.ts`.

Other providers (Anthropic, Perplexity, Grok) do not currently offer first-party image generation APIs, so they are excluded from the initial scope.

### API Surface

**Gemini (Nano Banana Pro):** Uses the existing `generateContent` endpoint with `responseModalities: ["TEXT", "IMAGE"]` on the `gemini-3-pro-image` model. Images are returned as inline base64 `image/png` data within the `parts` array alongside text parts. No new endpoint needed — just a modified request body.

**OpenAI (GPT Image 1.5):** Uses the `/v1/images/generations` endpoint (separate from chat completions). Returns base64-encoded image data. Parameters include `size` (`1024x1024`, `1024x1536`, `1536x1024`), `quality` (`low`, `medium`, `high`), and `output_format` (`png`, `webp`).

## 3. Architecture

### 3.1 How It Fits the Existing System

The current architecture follows this flow for text:

```
User → sendMessage mutation → Lambda → Provider API (streaming) → publishChunk → Subscription → Frontend
```

Image generation extends this by introducing a new message content type. The key architectural decision is: **images are delivered as a special chunk type through the existing streaming pipeline**, not through a separate API. This keeps the UX consistent — the user sends a message, and the assistant responds with content that may include images.

### 3.2 Message Content Model

Currently, `Message.content` is a plain string rendered as Markdown. To support images, we introduce a structured content format:

```typescript
// New: structured content block within a message
interface ContentBlock {
  type: 'text' | 'image'
  text?: string           // For type: 'text'
  imageUrl?: string       // For type: 'image' — S3 presigned URL or data URI
  mimeType?: string       // For type: 'image' — e.g. 'image/png'
  alt?: string            // For type: 'image' — accessibility text / prompt used
  width?: number
  height?: number
}
```

For backward compatibility, `Message.content` remains a string. A new optional field `Message.contentBlocks` holds structured content when present. Rendering logic checks `contentBlocks` first; if absent, falls back to `content` as plain Markdown.

```typescript
// Updated Message type (src/types/index.ts)
export interface Message {
  id: string
  content: string                    // Plain text / markdown (always populated for search, history)
  contentBlocks?: ContentBlock[]     // Structured content with images (when present)
  role: 'user' | 'assistant'
  timestamp: Date
  judgeRatings?: JudgeRatings
}
```

### 3.3 Image Detection: Explicit Mode, Not Implicit

Rather than trying to auto-detect whether a user prompt is "asking for an image" (which is error-prone and creates unexpected costs), image generation uses an **explicit trigger**:

- A toggle or button in the UI to switch the active provider into "image mode"
- Or a dedicated image generation provider entry in the provider selector (e.g., "Gemini Image", "OpenAI Image")

The recommended approach is **dedicated provider entries** in the provider selector. This is simpler to implement (no new UI component), makes cost implications obvious to users, and maps cleanly to the existing `ChatProvider` enum.

### 3.4 Data Flow

```
┌──────────┐    sendMessage     ┌──────────┐    generateContent     ┌──────────────┐
│ Frontend │ ──────────────────→│  Lambda   │ ─────────────────────→│ Gemini API   │
│          │  provider: GEMINI  │          │   responseModalities:  │ (Nano Banana)│
│          │  model: gemini-3.. │          │   ["TEXT","IMAGE"]     │              │
│          │                    │          │←─────────────────────── │              │
│          │                    │          │  parts: [{text}, {img}]│              │
│          │                    │          │                        └──────────────┘
│          │   publishChunk     │          │
│          │←───────────────────│          │    Upload image to S3
│          │  chunk: text       │          │──→ S3 (with presigned URL)
│          │                    │          │
│          │   publishChunk     │          │
│          │←───────────────────│          │
│          │  chunk: [IMAGE]    │          │
│          │  (JSON metadata)   │          │
└──────────┘                    └──────────┘
```

### 3.5 Image Storage

Raw base64 image data should not be stored in DynamoDB (400KB item limit, expensive reads). Instead:

1. **Lambda** receives base64 image data from the provider API
2. **Lambda** uploads to an S3 bucket with a key like `images/{userId}/{chatId}/{messageId}/{uuid}.png`
3. **Lambda** generates a presigned URL (24h expiry) or a CloudFront-signed URL
4. **Lambda** publishes the image URL as a special chunk to the frontend
5. **DynamoDB** stores the S3 key (not the URL) in the message's `contentBlocks`
6. **Frontend** requests fresh presigned URLs when loading chat history (via a new `getImageUrl` query, or by having the `getChat` resolver generate them on the fly)

### 3.6 Chunk Protocol Extension

The existing `MessageChunk` type carries a `chunk` string field. For image content, the chunk contains a JSON-encoded image descriptor instead of raw text:

```graphql
# No schema change needed — chunk is already String!
# Convention: if chunk starts with '{"type":"image"', parse as image metadata
```

Image chunk payload:

```json
{
  "type": "image",
  "url": "https://s3.amazonaws.com/...",
  "mimeType": "image/png",
  "alt": "A photorealistic banana on a marble countertop",
  "width": 1024,
  "height": 1024
}
```

The frontend's chunk handler detects JSON image blocks and appends them to `contentBlocks` rather than concatenating to the text buffer.

## 4. Implementation Plan

### Phase 1: Backend — Gemini Image Provider

**Files changed:**

| File | Change |
|---|---|
| `infrastructure/lambda/src/providers/gemini.ts` | Add `streamGeminiImage()` function using `gemini-3-pro-image` model with `responseModalities: ["TEXT", "IMAGE"]` |
| `infrastructure/lambda/src/chat.ts` | Detect image-mode models and call image-specific provider function |
| `infrastructure/lambda/src/validation.ts` | Add `GEMINI_IMAGE` to allowed providers, add image-specific validation (size, quality params) |
| `infrastructure/schema.graphql` | Add `GEMINI_IMAGE` and `OPENAI_IMAGE` to `ChatProvider` enum |
| `infrastructure/lambda/src/types.ts` | Add image-related types |
| `infrastructure/s3.tf` (new) | S3 bucket for generated images with lifecycle rules |
| `infrastructure/iam.tf` | Add S3 PutObject/GetObject permissions to Lambda role |

**New Lambda logic in `gemini.ts`:**

```typescript
export async function streamGeminiImage(
  apiKey: string,
  prompt: string,
  requestId: string,
  userId: string,
  chatId: string,
): Promise<number> {
  // 1. Call Gemini generateContent with responseModalities: ["TEXT", "IMAGE"]
  // 2. Parse response parts — extract text and inline_data (base64 image)
  // 3. Upload image to S3
  // 4. Publish text chunks via batcher
  // 5. Publish image chunk as JSON metadata
  // 6. Return token count
}
```

**S3 bucket configuration:**

```hcl
resource "aws_s3_bucket" "generated_images" {
  bucket = "${var.project_name}-${var.environment}-generated-images"
}

resource "aws_s3_bucket_lifecycle_configuration" "images_lifecycle" {
  bucket = aws_s3_bucket.generated_images.id
  rule {
    id     = "expire-old-images"
    status = "Enabled"
    expiration {
      days = 90  # Auto-delete images after 90 days
    }
  }
}
```

### Phase 2: Backend — OpenAI Image Provider

**Files changed:**

| File | Change |
|---|---|
| `infrastructure/lambda/src/providers/openai.ts` | Add `streamOpenAIImage()` function using `/v1/images/generations` endpoint |

```typescript
export async function streamOpenAIImage(
  apiKey: string,
  prompt: string,
  requestId: string,
  userId: string,
  chatId: string,
  options?: { size?: string; quality?: string }
): Promise<number> {
  // 1. POST to /v1/images/generations with model: 'gpt-image-1.5'
  // 2. Decode base64 response
  // 3. Upload to S3
  // 4. Publish image chunk as JSON metadata
  // 5. Return token count
}
```

### Phase 3: Frontend — Provider Registration & Message Rendering

**Files changed:**

| File | Change |
|---|---|
| `src/types/index.ts` | Add `ContentBlock` interface, add `contentBlocks?` to `Message` |
| `src/services/chatProviderRegistry.ts` | Add `gemini-image` and `openai-image` provider entries |
| `src/components/ChatMessage.tsx` | Render `contentBlocks` when present — display images inline with text |
| `src/components/ImageBlock.tsx` (new) | Image display component with loading state, lightbox, download |
| `src/services/appsyncChat.ts` | Parse image chunks from the subscription stream |
| `src/graphql/operations.ts` | Add `GEMINI_IMAGE` and `OPENAI_IMAGE` to provider mappings |
| `src/services/chatHistoryService.ts` | Serialize/deserialize `contentBlocks` for persistence |

**ChatMessage rendering logic:**

```tsx
// In ChatMessage.tsx assistant rendering
{message.contentBlocks ? (
  message.contentBlocks.map((block, i) => {
    if (block.type === 'text') {
      return <ReactMarkdown key={i}>{block.text}</ReactMarkdown>
    }
    if (block.type === 'image') {
      return <ImageBlock key={i} block={block} />
    }
    return null
  })
) : (
  <ReactMarkdown>{visibleContent}</ReactMarkdown>
)}
```

**ImageBlock component:**

```tsx
function ImageBlock({ block }: { block: ContentBlock }) {
  return (
    <Box sx={{ my: 2, maxWidth: 512 }}>
      <img
        src={block.imageUrl}
        alt={block.alt || 'Generated image'}
        style={{ maxWidth: '100%', borderRadius: 8 }}
        loading="lazy"
      />
    </Box>
  )
}
```

### Phase 4: Persistence

**Files changed:**

| File | Change |
|---|---|
| `infrastructure/schema.graphql` | Add `contentBlocks: AWSJSON` to `StoredMessage` and `SaveMessageInput` |
| VTL resolvers | Pass through `contentBlocks` field |
| `src/services/chatHistoryService.ts` | Map `contentBlocks` to/from `AWSJSON` |

DynamoDB message items gain a `contentBlocks` attribute storing the JSON-serialized array. The `content` field continues to hold the text-only portion for backward compatibility and to support search/preview without parsing JSON.

The S3 key (not the presigned URL) is stored in `contentBlocks[].imageUrl` as `s3://bucket/key`. The `getChat` resolver or a client-side service replaces these with fresh presigned URLs at read time.

### Phase 5: Image Options UI (Optional Enhancement)

Add a small options popover when an image provider is selected:

- **Size**: Square (1024×1024), Portrait (1024×1536), Landscape (1536×1024)
- **Quality**: Low, Medium, High (affects cost and detail)

These are passed as additional fields in `SendMessageInput` and forwarded to the provider API.

## 5. GraphQL Schema Changes

```graphql
# Add to ChatProvider enum
enum ChatProvider {
  OPENAI
  ANTHROPIC
  GEMINI
  PERPLEXITY
  GROK
  GEMINI_IMAGE    # New
  OPENAI_IMAGE    # New
}

# Add optional fields to SendMessageInput
input SendMessageInput {
  requestId: String!
  provider: ChatProvider!
  messages: [ChatMessageInput!]!
  model: String
  imageSize: String       # New — "1024x1024", "1024x1536", "1536x1024"
  imageQuality: String    # New — "low", "medium", "high"
}

# Add contentBlocks to stored messages
input SaveMessageInput {
  chatId: String!
  messageId: String!
  role: MessageRole!
  content: String!
  timestamp: String!
  contentBlocks: AWSJSON  # New
}

type StoredMessage @aws_oidc {
  messageId: String!
  role: MessageRole!
  content: String!
  timestamp: String!
  judgeRatings: AWSJSON
  contentBlocks: AWSJSON  # New
}
```

## 6. Security Considerations

- **S3 bucket**: Private, no public access. All image access through presigned URLs with 24h expiry.
- **Content moderation**: Both Gemini and OpenAI apply server-side content moderation to image generation requests. The Lambda should surface moderation rejections as user-visible error messages, not silent failures.
- **Rate limiting**: Image generation is more expensive than text. The existing rate limiter should apply higher token costs for image requests (e.g., 1 image = 1000 tokens against the daily budget).
- **Input validation**: Image prompts go through the same `validateMessages` pipeline. The prompt is the last user message content — no new attack surface.
- **S3 key isolation**: Keys are namespaced by `userId` to prevent cross-user access even if a presigned URL leaks.

## 7. Cost Estimation

| Provider | Quality | Cost/Image | 100 images/day |
|---|---|---|---|
| Gemini (Nano Banana Pro) | Standard | ~$0.04 | ~$4/day |
| Gemini (Nano Banana Pro) | Fast | ~$0.02 | ~$2/day |
| OpenAI (GPT Image 1.5) | Medium | ~$0.07 | ~$7/day |
| OpenAI (GPT Image 1.5) | High | ~$0.17 | ~$17/day |
| S3 storage (1MB avg) | — | $0.023/GB/mo | ~$0.07/mo for 3K images |

S3 costs are negligible. The 90-day lifecycle rule keeps storage bounded.

## 8. Alternatives Considered

### Alternative A: Separate image generation page/modal
Rejected. Splitting image generation into a separate UI breaks the conversational flow. Users expect to ask for images in chat (as with ChatGPT, Gemini app, etc.).

### Alternative B: Auto-detect image intent from prompt text
Rejected for initial implementation. Heuristic detection ("draw me a...", "generate an image of...") is unreliable and creates surprise costs. Explicit provider selection is clearer. Can be revisited later as an opt-in "smart routing" feature.

### Alternative C: Return images as base64 data URIs in chunks
Rejected. Base64 images are 1–4MB. Pushing this through AppSync WebSocket subscriptions would hit message size limits and degrade performance. S3 upload + URL reference is the correct approach.

### Alternative D: Store images in DynamoDB
Rejected. DynamoDB has a 400KB item size limit. Even compressed, images exceed this. S3 is the standard solution for binary blob storage.

## 9. Open Questions

1. **Judge integration**: Should the AI judges evaluate image generation responses? They currently evaluate text quality. Image evaluation would require multimodal judge prompts — probably a separate follow-up feature.

2. **Image editing**: Both Gemini and OpenAI support image editing (modify an existing image with a new prompt). This could be a future enhancement where users reference a previously generated image in follow-up messages.

3. **Multiple images per response**: Gemini can return multiple images. Should the UI support image grids, or limit to one image per response initially?

4. **Incognito mode**: In incognito mode, should generated images still be uploaded to S3 (and auto-deleted on session end), or should they be delivered as ephemeral data URIs despite the size cost?
