# Design: Image Generation Feature

## 1. Overview

Add image generation capabilities to the chatbot so users can generate images via natural language prompts within the existing chat interface. Images are generated server-side by LLM provider APIs and delivered to the frontend as inline content within assistant messages.

### Scope

This design covers single-turn image generation: user sends a prompt, assistant responds with generated image(s) and optional accompanying text. The following are explicitly **out of scope** for this iteration and will be addressed in future work:

- **Multimodal chat threads** — conversational image generation where follow-up messages reference/modify prior images
- **Image editing** — modifying an existing generated image with a new prompt (both Gemini and OpenAI support this, but it requires multimodal input threading)
- **Judge evaluation of image responses** — the existing AI judge system evaluates text quality; image quality evaluation would require multimodal judge prompts and is a separate feature

## 2. Provider Selection

### Two providers: Gemini (Nano Banana Pro) and OpenAI (GPT Image 1.5)

The app already integrates five LLM providers for text. We will support image generation through the two providers that already exist in the system and have strong image generation APIs:

| Provider | Model | Strengths | Cost/image |
|---|---|---|---|
| **Google Gemini** | Nano Banana Pro (`gemini-3-pro-image`) | Best photorealism, search grounding, few-shot consistency, thinking-before-generating | ~$0.04 (standard) |
| **OpenAI** | GPT Image 1.5 (`gpt-image-1.5`) | Best text rendering in images, highest LM Arena score, streaming support | ~$0.04–$0.17 |

**Gemini / Nano Banana Pro** is the primary provider. It produces excellent photorealistic output, it's cost-competitive, and crucially it uses the same `generateContent` API the app already calls for Gemini text streaming. This means the Lambda provider at `infrastructure/lambda/src/providers/gemini.ts` needs relatively modest changes compared to integrating a brand-new service. Its "thinking" capability (reasoning about the prompt before generating) also pairs well with the existing thinking-block UI. Gemini can also return multiple images in a single response, which we will support.

**OpenAI / GPT Image 1.5** is the secondary provider. It has the best text-in-image rendering (logos, signs, labels) and uses the familiar OpenAI API surface already implemented in `providers/openai.ts`.

Other providers (Anthropic, Perplexity, Grok) do not currently offer first-party image generation APIs, so they are excluded.

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

The approach is **dedicated provider entries** in the provider selector. This is simpler to implement (no new UI component), makes cost implications obvious to users, and maps cleanly to the existing `ChatProvider` enum. In the future, we may add multimodal chat threads where a single provider can produce both text and images within one conversation, but that is out of scope for this iteration.

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
| `src/components/ChatMessage.tsx` | Render `contentBlocks` when present — display images inline with text, show skeleton during generation |
| `src/components/ImageGallery.tsx` (new) | Multi-image gallery with responsive grid layout (1/2/3/4+ images) |
| `src/components/ImageCard.tsx` (new) | Individual image display with loading/error states, download overlay |
| `src/components/ImageLightbox.tsx` (new) | Full-screen image viewer with arrow navigation and swipe support |
| `src/services/appsyncChat.ts` | Parse image chunks from the subscription stream |
| `src/graphql/operations.ts` | Add `GEMINI_IMAGE` and `OPENAI_IMAGE` to provider mappings |
| `src/services/chatHistoryService.ts` | Serialize/deserialize `contentBlocks` for persistence |

**ChatMessage rendering logic:**

```tsx
// In ChatMessage.tsx assistant rendering
{message.contentBlocks ? (
  <>
    {/* Render text blocks with existing markdown pipeline */}
    {message.contentBlocks
      .filter(b => b.type === 'text')
      .map((block, i) => (
        <ReactMarkdown key={`text-${i}`}>{block.text}</ReactMarkdown>
      ))}
    {/* Render images via ImageGallery */}
    <ImageGallery
      images={message.contentBlocks.filter(b => b.type === 'image')}
    />
  </>
) : (
  <ReactMarkdown>{visibleContent}</ReactMarkdown>
)}
```

### Multi-Image Display UX

Gemini can return multiple images in a single response. The UI needs to handle 1, 2, 3, or 4+ images gracefully. The approach is a responsive image gallery component:

**Layout rules:**

| Count | Layout | Sizing |
|---|---|---|
| 1 image | Single image, full message width | `max-width: 512px`, maintain aspect ratio |
| 2 images | Side-by-side row | Each 50% of container width, equal height (crop to match) |
| 3 images | One large + two small: first image takes the left half, remaining two stack vertically on the right | Left: 50%, Right: 50% split into two rows |
| 4+ images | 2-column grid | Equal-width columns, images maintain aspect ratio |

**ImageGallery component (`src/components/ImageGallery.tsx`):**

```tsx
interface ImageGalleryProps {
  images: ContentBlock[]
}

function ImageGallery({ images }: ImageGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  if (images.length === 0) return null

  // Single image — simple display
  if (images.length === 1) {
    return (
      <Box sx={{ my: 2, maxWidth: 512 }}>
        <ImageCard
          block={images[0]}
          onClick={() => setLightboxIndex(0)}
        />
        {lightboxIndex !== null && (
          <ImageLightbox
            images={images}
            startIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </Box>
    )
  }

  // Multiple images — responsive grid
  return (
    <Box sx={{ my: 2, maxWidth: 600 }}>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 1,
        // For 3 images: first image spans both rows on the left
        ...(images.length === 3 && {
          gridTemplateRows: 'repeat(2, 1fr)',
          '& > :first-of-type': {
            gridRow: '1 / 3',
          },
        }),
      }}>
        {images.map((img, i) => (
          <ImageCard
            key={i}
            block={img}
            onClick={() => setLightboxIndex(i)}
            fill={images.length > 1}  // Use object-fit: cover in grid mode
          />
        ))}
      </Box>
      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </Box>
  )
}
```

**ImageCard component (individual image in the gallery):**

```tsx
interface ImageCardProps {
  block: ContentBlock
  onClick: () => void
  fill?: boolean  // true = cover the grid cell, false = natural aspect ratio
}

function ImageCard({ block, onClick, fill }: ImageCardProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        borderRadius: 1,
        overflow: 'hidden',
        cursor: 'pointer',
        bgcolor: 'action.hover',
        // Maintain aspect ratio or fill grid cell
        ...(fill
          ? { aspectRatio: '1', '& img': { objectFit: 'cover' } }
          : {}),
        '&:hover .image-overlay': { opacity: 1 },
      }}
    >
      {!loaded && !error && (
        <Skeleton variant="rectangular" width="100%" height={fill ? '100%' : 256} />
      )}
      {error ? (
        <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
          <BrokenImageIcon />
          <Typography variant="caption" display="block">Failed to load image</Typography>
        </Box>
      ) : (
        <img
          src={block.imageUrl}
          alt={block.alt || 'Generated image'}
          style={{ width: '100%', height: fill ? '100%' : 'auto', display: 'block', borderRadius: 4 }}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      )}
      {/* Hover overlay with download button */}
      <Box
        className="image-overlay"
        sx={{
          position: 'absolute', bottom: 0, right: 0,
          p: 0.5, opacity: 0, transition: 'opacity 0.2s',
        }}
      >
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); downloadImage(block) }}
          sx={{ bgcolor: 'rgba(0,0,0,0.5)', color: 'white', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}
```

**ImageLightbox component (full-screen overlay for viewing/navigating):**

```tsx
interface ImageLightboxProps {
  images: ContentBlock[]
  startIndex: number
  onClose: () => void
}

function ImageLightbox({ images, startIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(startIndex)
  // - Full-screen overlay with dark backdrop
  // - Left/right arrow navigation (keyboard + click)
  // - Image counter: "2 / 4"
  // - Download button
  // - Close on backdrop click or Escape key
  // - Swipe support on touch devices
}
```

**Loading state during generation:**

While the Lambda is processing the image generation request (which takes 5-15 seconds, longer than text), the UI shows a placeholder:

```tsx
// In the assistant message area, while streaming and no content yet
<Box sx={{ my: 2, maxWidth: 512 }}>
  <Skeleton
    variant="rectangular"
    width={512}
    height={384}
    sx={{ borderRadius: 1 }}
    animation="wave"
  />
  <Typography variant="caption" sx={{ mt: 0.5, color: 'text.secondary' }}>
    Generating image...
  </Typography>
</Box>
```

This skeleton placeholder is shown when the provider is an image provider and no content blocks have arrived yet. It transitions to the actual image once the image chunk is received.

### Phase 4: Persistence

**Files changed:**

| File | Change |
|---|---|
| `infrastructure/schema.graphql` | Add `contentBlocks: AWSJSON` to `StoredMessage` and `SaveMessageInput` |
| VTL resolvers | Pass through `contentBlocks` field |
| `src/services/chatHistoryService.ts` | Map `contentBlocks` to/from `AWSJSON` |

DynamoDB message items gain a `contentBlocks` attribute storing the JSON-serialized array. The `content` field continues to hold the text-only portion for backward compatibility and to support search/preview without parsing JSON.

The S3 key (not the presigned URL) is stored in `contentBlocks[].imageUrl` as `s3://bucket/key`. The `getChat` resolver or a client-side service replaces these with fresh presigned URLs at read time.

### Phase 5: Incognito Mode Support

**Files changed:**

| File | Change |
|---|---|
| `infrastructure/lambda/src/chat.ts` | Use `ephemeral/` S3 prefix when request is from incognito session |
| `infrastructure/lambda/src/cleanupImages.ts` (new) | Lambda to batch-delete ephemeral S3 objects on session end |
| `infrastructure/api-gateway.tf` (new) | HTTP API Gateway endpoint for `POST /cleanup-images` |
| `infrastructure/s3.tf` | Add `ephemeral/` lifecycle rule (1-day expiry safety net) |
| `src/App.tsx` | Add `beforeunload` handler with `navigator.sendBeacon` for active cleanup |
| `infrastructure/schema.graphql` | Add `incognito: Boolean` to `SendMessageInput` so Lambda knows the S3 prefix |

### Phase 6: Image Options UI (Optional Enhancement)

Add a small options popover when an image provider is selected:

- **Size**: Square (1024x1024), Portrait (1024x1536), Landscape (1536x1024)
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

- **S3 bucket**: Private, no public access. All image access through presigned URLs with 24h expiry (1h for incognito/ephemeral images).
- **Content moderation**: Both Gemini and OpenAI apply server-side content moderation to image generation requests. The Lambda should surface moderation rejections as user-visible error messages, not silent failures.
- **Rate limiting**: Image generation is more expensive than text. The existing rate limiter should apply higher token costs for image requests (e.g., 1 image = 1000 tokens against the daily budget).
- **Input validation**: Image prompts go through the same `validateMessages` pipeline. The prompt is the last user message content — no new attack surface.
- **S3 key isolation**: Keys are namespaced by `userId` to prevent cross-user access even if a presigned URL leaks.
- **Judge bypass**: The frontend skips judge evaluation entirely when the active provider is an image provider (`GEMINI_IMAGE`, `OPENAI_IMAGE`). The judge system is designed for text quality evaluation and does not apply to image responses.
- **Ephemeral cleanup endpoint**: The `POST /cleanup-images` endpoint validates the session token and restricts deletion to the `ephemeral/` prefix only, preventing abuse as a general-purpose S3 deletion tool.

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

## 9. Incognito Mode

Incognito mode presents a unique challenge for image generation. Text responses are trivially ephemeral — they exist only in browser memory and vanish when the tab closes. Images, however, must be uploaded to S3 to avoid pushing multi-megabyte base64 payloads through WebSocket subscriptions. This creates a tension: we need S3 for delivery, but we need the images to disappear.

### Approach: Short-TTL S3 Objects + Best-Effort Cleanup

**Primary mechanism — S3 object expiration:**
- Images generated in incognito mode are uploaded to a separate S3 prefix: `ephemeral/{userId}/{requestId}/{uuid}.png`
- These objects are tagged with `ephemeral=true` and have a short S3 object expiration (1 hour via `Expires` header on PutObject)
- A separate S3 lifecycle rule targets the `ephemeral/` prefix with a 1-day expiration as a safety net (S3 lifecycle is evaluated once daily, so the per-object `Expires` header is the primary TTL, and the lifecycle rule catches anything that slips through)

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "images_lifecycle" {
  bucket = aws_s3_bucket.generated_images.id

  rule {
    id     = "expire-standard-images"
    status = "Enabled"
    filter { prefix = "images/" }
    expiration { days = 90 }
  }

  rule {
    id     = "expire-ephemeral-images"
    status = "Enabled"
    filter { prefix = "ephemeral/" }
    expiration { days = 1 }  # Safety net — per-object Expires handles the fast path
  }
}
```

**Best-effort active cleanup — `beforeunload` + API call:**
- When the user closes the tab or navigates away, the frontend fires a `beforeunload` handler
- This sends a `navigator.sendBeacon()` request to a lightweight cleanup endpoint (API Gateway + Lambda) that deletes the S3 objects for that incognito session
- `sendBeacon` is fire-and-forget and works reliably during page unload (unlike `fetch` which browsers often cancel)
- This is **best-effort** — if the beacon fails (browser killed, network down), the S3 TTL handles cleanup within 1 hour

```typescript
// In App.tsx, when incognito chat has image messages
useEffect(() => {
  if (!incognitoMode || !hasIncognitoImages) return

  const cleanup = () => {
    const keys = getIncognitoImageKeys() // Collect S3 keys from contentBlocks
    if (keys.length > 0) {
      navigator.sendBeacon(
        `${CLEANUP_ENDPOINT}`,
        JSON.stringify({ keys, token: getSessionToken() })
      )
    }
  }

  window.addEventListener('beforeunload', cleanup)
  return () => window.removeEventListener('beforeunload', cleanup)
}, [incognitoMode, hasIncognitoImages])
```

**New infrastructure for cleanup:**

| Resource | Purpose |
|---|---|
| API Gateway HTTP endpoint (`POST /cleanup-images`) | Receives `sendBeacon` payload |
| Lambda function (`cleanupImages`) | Validates session token, batch-deletes S3 objects |
| IAM policy | `s3:DeleteObject` scoped to `ephemeral/` prefix only |

**Why not use data URIs for incognito?**

Data URIs would avoid S3 entirely but have serious drawbacks:
- Base64-encoded images are 1-4MB each; pushing this through AppSync WebSocket chunks would hit the 240KB WebSocket frame limit
- Multiple images per response would multiply the problem
- Browser memory pressure from multiple large data URIs degrades performance
- The short-TTL S3 approach achieves "practically ephemeral" (1 hour worst case) without these tradeoffs

### Incognito UX Note

When an image provider is selected in incognito mode, a subtle info chip below the provider selector will read: *"Images auto-delete within 1 hour"* — so the user understands the ephemerality guarantee for images differs from text (which is instant).

## 10. Future Work

These items are explicitly deferred from this iteration:

1. **Multimodal chat threads** — allow follow-up messages in an image chat to reference and modify prior images, enabling conversational image workflows
2. **Image editing** — use Gemini's and OpenAI's image editing APIs to modify existing generated images with new prompts
3. **Judge evaluation of images** — extend the AI judge system with multimodal prompts to evaluate image quality, prompt adherence, and aesthetic merit
4. **Smart routing** — auto-detect image generation intent from prompt text and route to the image provider without requiring manual provider selection
