# Voice Input Feature Design Document

**Date:** 2026-02-16
**Status:** Draft

## 1. Overview

Add voice input capability to the chatbot so users can speak messages instead of typing them. Audio is transcribed server-side using the OpenAI Whisper API, and the resulting text is sent as a normal chat message through the existing pipeline.

## 2. Goals

- Users can tap a microphone button, speak, and have their speech transcribed into a chat message.
- Transcription always runs through OpenAI Whisper on the backend — no reliance on the browser's Web Speech API or any other browser-native speech recognition.
- The transcribed text is editable before sending, giving users a chance to correct errors.
- The feature integrates cleanly with the existing chat flow without modifying the message-sending pipeline.

## 3. Non-Goals

- Real-time streaming transcription (live partial results while speaking). Whisper operates on complete audio files.
- Voice output / text-to-speech for assistant responses.
- Speaker identification or diarization.
- Support for audio file uploads (only live microphone recording).
- Changing the `Message` type or persisting audio blobs. Voice messages are stored as plain text after transcription.

## 4. Architecture

### 4.1 Approach: Backend Transcription via New Lambda

Audio is recorded in the browser, sent to a new backend Lambda function, transcribed by Whisper, and the text is returned to the frontend. The frontend then places the transcript into the chat input for the user to review and send.

**Why backend instead of calling Whisper directly from the frontend:**

- **API key security.** The OpenAI API key is already stored in Secrets Manager and used by the chat Lambda. Calling Whisper from the frontend would require exposing an API key to the client or building a separate proxy — the Lambda already solves this.
- **Consistency.** All LLM API calls go through the backend today. Adding a client-side API call would break that pattern and complicate rate limiting and cost tracking.
- **Auditability.** Backend transcription gives a single place to log usage, enforce limits, and monitor costs.

### 4.2 System Flow

```
┌─────────┐       ┌────────────┐       ┌─────────────┐       ┌─────────┐
│  Browser │──────▶│  AppSync   │──────▶│  Transcribe │──────▶│ Whisper │
│ (record  │ audio │ (GraphQL   │invoke │  Lambda     │ HTTP  │   API   │
│  + send) │ b64   │  mutation) │       │             │       │         │
│          │◀──────│            │◀──────│             │◀──────│         │
│ (display │ text  │            │result │             │ JSON  │         │
│  in input)       └────────────┘       └─────────────┘       └─────────┘
```

1. User clicks the microphone button in `ChatInput`.
2. Browser records audio via the MediaRecorder API.
3. User clicks stop (or a max duration is reached).
4. Frontend sends the audio as a base64-encoded string to a new `transcribeAudio` GraphQL mutation.
5. The transcribe Lambda decodes the audio, calls the OpenAI Whisper API, and returns the transcript.
6. Frontend populates the chat input TextField with the transcript.
7. User reviews, optionally edits, and sends the message through the normal `handleSend` flow.

### 4.3 Why Not an Integrated Voice-to-Chat Pipeline

An alternative would combine transcription and chat response into a single request (`sendVoiceMessage`). This was rejected because:

- It removes the user's ability to review and correct the transcript before sending.
- It couples two independent operations (transcription and chat completion), making error handling more complex.
- It doesn't align with how users expect voice input to work in messaging apps — they want to see what was transcribed.

## 5. Detailed Design

### 5.1 Frontend Changes

#### 5.1.1 ChatInput Component (`src/components/ChatInput.tsx`)

Add a microphone toggle button to the left of the existing send/stop button.

**New state:**

```typescript
type RecordingState = 'idle' | 'recording' | 'transcribing'
```

- `idle` — Default. Mic button is shown in its inactive state.
- `recording` — Mic is active, audio is being captured. The mic button pulses or changes color (red) to indicate recording. A duration timer is displayed.
- `transcribing` — Recording has stopped and audio is being sent to the backend. A spinner replaces the mic button.

**Behavior:**

| State        | Mic button action  | Send button             |
|--------------|--------------------|-------------------------|
| idle         | Start recording    | Send text (unchanged)   |
| recording    | Stop recording     | Hidden or disabled      |
| transcribing | Disabled           | Disabled                |

After transcription completes, the state returns to `idle` and the transcript text is inserted into the input field (appended to any existing text, separated by a space). The input field is focused so the user can edit immediately.

**Updated props (no changes needed).** The existing `onSend` callback is reused. Voice input only changes how text gets into the input field, not how it is sent.

#### 5.1.2 Voice Recording Hook (`src/hooks/useVoiceRecorder.ts`)

Encapsulate MediaRecorder logic in a custom hook:

```typescript
interface UseVoiceRecorderReturn {
  state: RecordingState
  duration: number            // seconds elapsed while recording
  startRecording: () => void
  stopRecording: () => void   // resolves when transcription completes
  transcript: string | null
  error: string | null
  isSupported: boolean        // false if MediaRecorder or getUserMedia unavailable
}
```

**Audio format:** Record as `audio/webm;codecs=opus` (widely supported in modern browsers and accepted by Whisper). Fall back to `audio/webm` if the codec is not supported.

**Max duration:** 120 seconds. Recording auto-stops at this limit. This keeps audio payloads reasonable (WebM/Opus at ~32kbps produces roughly 480KB for 2 minutes) and aligns with typical voice message lengths.

**Permissions:** On first use, the browser will prompt for microphone access. If denied, `error` is set to a user-friendly message and `isSupported` remains true (the device has a mic, but the user blocked it — they can change this).

#### 5.1.3 Transcription Service (`src/services/transcriptionService.ts`)

```typescript
export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string>
```

- Calls the `transcribeAudio` GraphQL mutation via the existing AppSync client (reuses JWT auth from `appsyncClient.ts`).
- Returns the transcribed text string.
- Throws on error (network failure, Lambda error, empty transcript).

#### 5.1.4 UI Details

- The mic button uses the MUI `MicIcon` / `MicOffIcon` from `@mui/icons-material`.
- During recording, display elapsed time as `0:00` format next to the button.
- During transcription, show a `CircularProgress` spinner (small, inline) replacing the mic icon.
- Error states show a Snackbar (consistent with existing error handling in `App.tsx`). Common errors:
  - "Microphone access denied. Check your browser permissions."
  - "Microphone not available on this device."
  - "Transcription failed. Please try again."
  - "Recording too short. Please speak for at least 1 second."

### 5.2 GraphQL Schema Changes (`infrastructure/schema.graphql`)

Add a new mutation and response type:

```graphql
input TranscribeAudioInput {
  audio: String!       # Base64-encoded audio data
  mimeType: String!    # e.g. "audio/webm;codecs=opus"
}

type TranscriptionResult @aws_oidc {
  text: String!
  duration: Float      # Audio duration in seconds (from Whisper response)
}

type Mutation {
  # ... existing mutations ...
  transcribeAudio(input: TranscribeAudioInput!): TranscriptionResult
    @aws_oidc
}
```

No subscription needed — transcription is a synchronous request/response (Whisper processes short audio in a few seconds, well within AppSync's 30-second timeout).

### 5.3 Backend Changes

#### 5.3.1 Transcribe Lambda (`infrastructure/lambda/src/transcribe.ts`)

New handler following the same patterns as existing Lambda functions:

```typescript
interface TranscribeEventArgs {
  input: {
    audio: string      // base64
    mimeType: string
  }
}

export async function handler(
  event: AppSyncEvent<TranscribeEventArgs>
): Promise<{ text: string; duration: number }>
```

**Flow:**

1. Extract and validate input (audio size, mime type).
2. Decode base64 audio into a Buffer.
3. Load OpenAI API key from Secrets Manager (reuses existing `getSecrets()` and the `OPENAI_API_KEY` already stored there).
4. Call the Whisper API (`POST https://api.openai.com/v1/audio/transcriptions`) with:
   - `model: "whisper-1"`
   - `file`: audio buffer as a file upload
   - `response_format: "verbose_json"` (to get duration metadata)
5. Return `{ text, duration }`.

**Validation rules:**

- Audio payload max size: 25MB after base64 decoding (Whisper API limit). In practice, 2 minutes of WebM/Opus is well under 1MB.
- Base64-encoded payload max size: ~34MB (accounting for base64 overhead). AppSync has a 1MB request payload limit, so this is actually capped at roughly 750KB of decoded audio. This is sufficient for ~3 minutes of WebM/Opus. If longer recordings are needed in the future, an S3 pre-signed URL upload pattern can replace inline base64.
- Allowed MIME types: `audio/webm`, `audio/webm;codecs=opus`, `audio/mp4`, `audio/mpeg`, `audio/wav`.
- Empty or extremely short audio (< 0.5 seconds duration after Whisper processing) returns an error.

**Error handling:**

- Whisper API errors are caught and returned as structured errors with user-readable messages.
- Rate limit errors from OpenAI (429) are surfaced as "Service busy, please try again."

#### 5.3.2 Validation (`infrastructure/lambda/src/validation.ts`)

Add a `validateTranscribeInput` function:

```typescript
export function validateTranscribeInput(input: TranscribeEventArgs['input']): void
```

Checks audio size and MIME type allowlist.

#### 5.3.3 Lambda Handler Export (`infrastructure/lambda/src/index.ts`)

Add the transcribe handler export:

```typescript
export { handler as transcribeHandler } from './transcribe'
```

#### 5.3.4 Rate Limiting

Reuse the existing per-user daily request counter in DynamoDB. Each transcription counts as one request toward the daily limit. No separate token tracking is needed since Whisper pricing is per-minute-of-audio, not per-token, but the `duration` value returned by Whisper should be logged for cost monitoring.

### 5.4 Infrastructure Changes (`infrastructure/`)

#### 5.4.1 Lambda Function (`lambda.tf`)

Add a new Lambda function resource for the transcribe handler:

```hcl
resource "aws_lambda_function" "transcribe" {
  function_name = "${var.project_name}-transcribe"
  handler       = "index.transcribeHandler"
  runtime       = "nodejs22.x"
  timeout       = 30  # Whisper typically responds in 2-5s for short audio
  memory_size   = 256

  environment {
    variables = {
      SECRETS_NAME       = aws_secretsmanager_secret.llm_api_keys.name
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.chats.name
    }
  }
}
```

Uses the same deployment package (`lambda/package.zip`) as the other functions since all handlers are compiled together.

#### 5.4.2 AppSync Resolver

Add a new direct Lambda resolver for the `transcribeAudio` mutation, following the same pattern as the existing `sendMessage` resolver:

- Request mapping template: passes the full mutation input to the Lambda.
- Response mapping template: returns the Lambda response directly.

#### 5.4.3 IAM

The transcribe Lambda needs:

- `secretsmanager:GetSecretValue` on the LLM secrets (same as chat Lambda).
- `dynamodb:UpdateItem` on the chats table (for rate limit counter).
- No AppSync publish permissions needed (no subscription streaming).

These can be defined in a new IAM role or the permissions can be shared with the existing chat Lambda role if appropriate.

### 5.5 No Changes Required

The following parts of the system are **not modified**:

- **Message types** (`src/types/index.ts`). Voice messages become plain text after transcription. No new `sourceType` field — this adds complexity for no user-facing benefit at this stage.
- **Chat history / DynamoDB schema.** Messages are stored identically regardless of input method.
- **Existing chat streaming pipeline** (`appsyncChat.ts`, `chat.ts`, providers). The transcript is sent through the same `handleSend` path as typed text.
- **Judge system.** Judges evaluate the text content regardless of how it was input.
- **Secrets Manager structure.** The existing `OPENAI_API_KEY` is reused for Whisper (same OpenAI account).

## 6. AppSync Payload Size Constraint

AppSync enforces a 1MB limit on request payloads. With base64 encoding overhead (~33%), this limits audio to roughly 750KB decoded. At WebM/Opus bitrates (~32kbps), this supports approximately 3 minutes of audio — more than adequate for voice messages.

If longer recordings are needed in the future, the design can be extended with an S3 pre-signed URL upload flow:

1. Frontend requests a pre-signed upload URL via a new `getUploadUrl` mutation.
2. Frontend uploads audio directly to S3.
3. Frontend calls `transcribeAudio` with the S3 key instead of inline base64.
4. Lambda reads audio from S3 and calls Whisper.

This is deferred since the 2-minute recording cap makes it unnecessary for the initial implementation.

## 7. Browser Compatibility

The MediaRecorder API is supported in all modern browsers:

| Browser         | MediaRecorder | getUserMedia | WebM/Opus |
|-----------------|---------------|--------------|-----------|
| Chrome 49+      | Yes           | Yes          | Yes       |
| Firefox 25+     | Yes           | Yes          | Yes       |
| Safari 14.1+    | Yes           | Yes          | No (MP4)  |
| Edge 79+        | Yes           | Yes          | Yes       |

**Safari note:** Safari does not support WebM. The MediaRecorder on Safari produces `audio/mp4`. The `useVoiceRecorder` hook detects the browser's supported MIME types at initialization and selects the best available format. The backend accepts both WebM and MP4, and Whisper handles both formats natively.

**Fallback:** If `MediaRecorder` or `getUserMedia` is unavailable (older browsers, insecure contexts without HTTPS), the mic button is not rendered. No error, no broken UI — the feature is simply absent.

## 8. Security Considerations

- **Microphone access** requires HTTPS and an explicit user permission grant. The browser enforces this; no additional work needed.
- **Audio data** is transmitted over HTTPS (AppSync endpoint) and authenticated with the user's Clerk JWT. Audio is not persisted — it exists only in memory during the Lambda invocation.
- **API key** stays server-side in Secrets Manager. The frontend never sees the OpenAI key.
- **Input validation** on the Lambda prevents oversized payloads and restricts MIME types to known audio formats. Base64 decoding is done safely with error handling for malformed input.
- **Rate limiting** reuses the existing per-user daily request counter, preventing abuse.

## 9. Testing Plan

### Unit Tests

- `useVoiceRecorder` hook: mock `MediaRecorder` and `getUserMedia`, test state transitions (idle → recording → transcribing → idle), error states (permission denied, no mic), auto-stop at max duration.
- `transcriptionService.ts`: mock AppSync client, verify correct mutation and input format, error propagation.
- `transcribe.ts` Lambda: mock Whisper API, test validation (bad MIME type, oversized audio, empty audio), successful transcription, Whisper error handling.
- `validateTranscribeInput`: edge cases for all validation rules.

### Integration Tests

- Record audio in a test browser, send to deployed Lambda, verify transcript matches spoken words.
- Verify rate limiting applies to transcription requests.
- Verify Safari (MP4) and Chrome (WebM) both produce valid transcriptions.

### Manual Testing

- Test microphone permission flow (first grant, denial, revocation).
- Test on mobile browsers (iOS Safari, Android Chrome).
- Test with background noise, accents, multiple languages.
- Test concurrent voice and text input (start typing, switch to voice, verify text is preserved and transcript is appended).
- Test network disconnection during transcription (verify error message).

## 10. Future Considerations

These are explicitly out of scope but worth noting for future work:

- **Streaming transcription.** OpenAI does not currently offer a streaming Whisper API. If they do in the future, partial transcripts could be displayed in real time as the user speaks.
- **Voice output.** Pair with OpenAI TTS to read assistant responses aloud.
- **Audio message storage.** Save the original audio in S3 and link it to the message for playback.
- **Whisper model upgrades.** When newer Whisper models are released, the `model` parameter in the Lambda can be updated without frontend changes.
