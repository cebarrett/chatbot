# Product Requirements Document: Chatbot v2

## Overview

This document defines the requirements for making the multi-provider LLM chatbot ready to share with non-technical friends and family.

### Current State

The app is a functional multi-provider AI chatbot with a React + TypeScript frontend and AWS serverless backend. It supports five LLM providers (OpenAI GPT-5.2, Anthropic Claude Opus 4.6, Google Gemini 3 Pro, Perplexity Sonar Reasoning Pro, and xAI Grok 4.1) with real-time streaming responses. An AI reviewer system allows up to four independent models to evaluate each response's quality, surface problems, and answer follow-up questions about their evaluations. The app includes Clerk authentication, DynamoDB chat history persistence, per-user rate limiting and token budgets, voice input via Whisper transcription, extended thinking display for Claude and Gemini, dark/light/system theme support, and reviewer disagreement highlighting. User-facing terminology refers to the evaluation system as "reviewers" rather than "judges."

### Value Proposition

This app is not just a free alternative to ChatGPT Plus. Its differentiating feature is the multi-reviewer system: independent AI models that critique each other's responses, surface problems, and let users ask follow-up questions about the evaluation. For non-technical users encountering AI for the first time -- or skeptical users who distrust it -- this transparency is the product.

Most AI chat apps present responses as authoritative. This app does the opposite: it treats every response as something to be questioned. That makes it uniquely suited for helping people develop the critical evaluation skills they need to use AI effectively, including recognizing hallucinations, understanding when models are confident vs. guessing, and learning that different AI systems give different answers to the same question.

The goal is to help users get comfortable with both the power and the limitations of current AI, so they can use it productively without being misled by it.

### Target Audience

Non-technical users (friends and family) who:
- Currently use or would consider paying for ChatGPT, Claude, or similar services
- Are curious about AI but unsure how much to trust it
- Are skeptical of AI hype and want to see the cracks for themselves
- Have never used an AI chatbot and need safe, guided first exposure

### Success Criteria

- Users can start chatting within 30 seconds of first visit with no confusion
- No single user can cause runaway API costs
- Errors are surfaced clearly, never silently swallowed
- Core workflows (chat, delete, edit) feel safe and forgiving
- Users engage with reviewer ratings on at least 30% of responses (expand, read explanations, or ask follow-ups)
- Users who complete onboarding can articulate at least one limitation of AI chat (e.g., "it can make things up" or "different AIs give different answers")
- The reviewer system is understood as "AI checking AI," not confused for a human review or ignored entirely

---

## P0: Must-Have (Before Sharing)

### 1. Confirmation for Message Deletion and Editing

**Status:** Partially complete. Chat deletion from the sidebar has a confirmation dialog. Message deletion and message editing do not.

**Problem:** Deleting a message permanently removes it and its AI response with no confirmation. Editing the last message silently replaces the previous AI response. Non-technical users will lose content by accident.

**Remaining requirements:**
- Add a confirmation dialog before deleting a message ("Delete this message and its response? This can't be undone.")
- When editing a message, warn that the previous AI response will be replaced
- Consider adding soft-delete with a 30-day retention period

### 2. First-Visit Onboarding with AI Literacy Framing

**Status:** Not started. User preferences infrastructure (backend + frontend with localStorage caching and DynamoDB persistence) is in place to support storing onboarding completion state.

**Problem:** No explanation of features exists in the app. The reviewer system, provider selector, and incognito mode are undiscoverable to new users. More importantly, the app's core value -- helping users critically evaluate AI responses -- is never communicated. Users who don't understand why the reviewer system exists will ignore it.

**Requirements:**
- Show a lightweight onboarding flow on first sign-in (4-5 steps max):
  1. **"AI is useful, but not perfect"** -- set expectations upfront. AI chatbots can be confidently wrong, make things up, or give different answers depending on the day. This app is designed to help you see that for yourself.
  2. **"Choose your AI"** -- explain the provider selector and that each provider is a different AI system with different strengths and blind spots.
  3. **"Every response gets a second opinion"** -- explain that independent AI reviewers automatically evaluate each response and flag potential problems. This is like having a fact-checker built in, though the fact-checker can be wrong too.
  4. **"Ask the reviewers why"** -- show that users can tap on a reviewer rating and ask follow-up questions like "Is this really accurate?" or "What should I verify?"
  5. **"You're the final judge"** -- close by reinforcing that the scores and evaluations are tools to help the user think, not a stamp of approval. Encourage users to question everything, including the reviewers.
- Store completion state via the user preferences system so it only shows once
- Add a "?" help button in the header that re-triggers the onboarding or shows a help summary
- Add brief helper text in the reviewer menu explaining what each reviewer does and why having multiple reviewers matters ("Different AI models catch different problems")

**Why P0:** Without onboarding, the reviewer system -- the app's main differentiator -- will be ignored or misunderstood by every new user. This is the single most important feature for the target audience.

---

## P1: Should-Have (First Week)

### 3. Visible Scoring Rubric

**Status:** Not started.

**Problem:** The reviewer scoring rubric (1-3 = poor, 4-5 = below average, 6-7 = average, 8-9 = good, 9-10 = excellent) and the evaluation criteria (accuracy, helpfulness, completeness, clarity) are buried in the Lambda system prompt. Users see a number like "7.5" with no context for what it means or what the reviewer was looking for.

**Requirements:**
- Add a "How scoring works" expandable section accessible from the rating area (e.g., a small "?" icon next to the score)
- Show the score scale with descriptions (Poor / Below Average / Average / Good / Excellent)
- List the evaluation dimensions: accuracy, helpfulness, completeness, and clarity
- Keep it brief -- a single compact card, not a wall of text
- This helps users internalize the criteria and develop their own evaluation instincts over time

### 4. Copy Button on Code Blocks

**Status:** Not started.

**Problem:** Code blocks rendered via react-syntax-highlighter have no copy mechanism. On mobile, selecting and copying code is especially painful.

**Requirements:**
- Add a "Copy" button in the top-right corner of every code block
- Show brief "Copied!" confirmation feedback
- Works on both desktop and mobile

### 5. Content Moderation

**Status:** Not started.

**Problem:** No input or output filtering exists. The app relies entirely on upstream LLM provider safety filters, which vary in strictness.

**Requirements:**
- Evaluate and document the safety guarantees of each provider's API
- Add an optional input filter that flags or blocks clearly inappropriate prompts before they reach the API
- At minimum, log flagged content for review
- Consider age-gating or usage agreements if minors may have access

### 6. Multi-Model Comparison View

**Status:** Not started.

**Problem:** Nothing teaches "AI is not an oracle" faster than seeing three different models give three different answers to the same question. The existing multi-provider architecture already supports this, but users can only talk to one provider at a time.

**Requirements:**
- Add a "Compare" mode that sends the same prompt to 2-3 selected providers simultaneously
- Display responses side by side (desktop) or stacked with clear provider labels (mobile)
- Each response gets its own reviewer evaluations
- Highlight differences between responses (even a simple "Responses differ" notice is valuable)
- Frame this feature in the UI as a learning tool: "See how different AIs answer the same question"

**AI literacy value:** This is one of the highest-impact features for shifting users' mental model from "AI gives me the answer" to "AI gives me an answer." When users see three confident, well-written, but contradictory responses, the lesson is immediate and visceral.

---

## P2: Nice-to-Have (First Month)

### 7. Hallucination-Specific Evaluation

**Problem:** The current reviewer system evaluates general quality (accuracy, helpfulness, completeness, clarity) but doesn't specifically flag hallucinated content. The `problems` array can contain anything. If teaching users to watch for hallucinations is a core goal, the reviewer system needs to call this out explicitly.

**Requirements:**
- Add a hallucination-focused evaluation dimension to the reviewer system prompt, asking reviewers to specifically identify:
  - Claims that cannot be verified or are likely fabricated
  - Invented citations, statistics, or sources
  - Confident statements about topics where the model is likely guessing
- Display hallucination warnings distinctly in the UI, separate from general quality issues (e.g., a "Verify this" label or icon on flagged claims)
- Consider a simple "Confidence" indicator alongside the quality score: "The reviewer thinks some claims in this response may need verification"
- This should complement, not replace, the existing general quality evaluation

### 8. Suggested Follow-Up Questions for Reviewers

**Problem:** The follow-up question feature (asking a reviewer "why did you rate this a 7?") is one of the most valuable AI literacy tools in the app, but it requires users to know what to ask. Non-technical users may not engage with it because they don't have a question in mind.

**Requirements:**
- Pre-populate 2-3 suggested follow-up questions below the reviewer's explanation, tailored to the rating context:
  - For low scores: "What's wrong with this response?" / "How could I get a better answer?"
  - For high scores: "Is there anything I should double-check?" / "What's missing from this answer?"
  - General: "Could this response be misleading?" / "How confident should I be in this?"
- Suggested questions appear as tappable chips, not a dropdown or menu
- Tapping a chip submits it immediately (same as typing and sending a follow-up)
- This dramatically lowers the barrier to engaging with the reviewer system

### 9. Persistent AI Literacy Nudges

**Problem:** Even with good onboarding, users will forget the critical evaluation mindset after a few sessions. The app needs subtle, ongoing reminders that AI responses should be questioned.

**Requirements:**
- Add a subtle, non-intrusive caveat beneath each AI response: "AI responses may contain errors. Tap the ratings below for a second opinion." This should be visually muted (small, low-contrast text) so it doesn't dominate the UI, but present enough to normalize the idea that verification is expected.
- Periodically (e.g., every 10th message), show a slightly more prominent tip: "Did you know? Different AI models often disagree with each other. Try switching providers to compare answers."
- These nudges should be dismissible per-session and respect a "don't show again" preference
- The tone should be helpful and empowering, never condescending: "Here's how to get more out of this" rather than "Be careful, AI is dangerous"

### 10. Example Conversations

**Problem:** Non-technical users landing in an empty chat may not know what to ask, and won't see the reviewer system in action until they send a message. Pre-loaded examples could demonstrate the app's value immediately.

**Requirements:**
- Offer 2-3 pre-loaded example conversations accessible from the empty chat state:
  - One where a response got a high score with a clean evaluation
  - One where a response got a low score with clear problems identified (e.g., a hallucinated fact)
  - One showing reviewer disagreement, with the user asking a follow-up question
- These should be clearly labeled as examples ("See how it works") and not mixed into the user's chat history
- Users can dismiss them and start fresh at any time

### 11. File & Image Upload

**Problem:** ChatGPT supports uploading PDFs, images, and documents. This is one of its most-used features for casual users ("read this menu", "what's this error screenshot"). The app is text-only.

**Requirements:**
- Support image upload for vision-capable models (GPT-5.2, Claude Opus 4.6, Gemini 3 Pro)
- Display uploaded images inline in the chat
- Support PDF text extraction for context injection
- Show clear errors for unsupported file types or sizes
- Set file size limits (e.g. 10MB images, 20MB PDFs)

### 12. Web Search Integration

**Problem:** Perplexity has built-in search capabilities but citations are stripped out. Users asking about current events get stale or incorrect answers from other providers.

**Requirements:**
- Preserve and display Perplexity citations/sources as clickable links
- Consider adding a "Search" toggle or auto-detecting queries that need current information
- Show a visual indicator when a response includes web search results

### 13. Improved Mobile Experience

**Status:** Partially addressed. iPhone Safari viewport height and page scroll issues have been fixed. Mobile layout for reviewer ratings and assistant messages has been improved.

**Remaining requirements:**
- Add haptic feedback on send (where supported)
- Add swipe-to-delete on chat history items
- Test on small phones (320px), tablets, and landscape orientations
- Ensure touch targets are at least 44x44px per accessibility guidelines

### 14. Chat Sharing & Export

**Problem:** No way to share an interesting conversation or export chat history.

**Requirements:**
- "Share" button that generates a read-only link to a conversation
- Export chat as markdown or plain text
- Shared links should not require authentication to view
- Optionally redact user messages in shared view

---

## P3: Future Considerations

### 15. Custom System Prompts

Allow users to set a persistent system prompt ("You are a helpful cooking assistant") per chat or globally.

### 16. Prompt Library with AI Literacy Templates

Pre-built prompt templates, but framed around critical thinking rather than just productivity:
- **"Test the AI"** prompts that are known to produce hallucinations or inconsistencies (e.g., asking for fake citations, asking about very recent events, asking for medical/legal advice)
- **"Compare answers"** templates that encourage sending the same question to multiple providers
- **Everyday tasks:** summarize, translate, explain like I'm 5, proofread -- with tips on verifying the output
- Each template should include a brief note on what to watch out for ("AI translations can miss cultural nuance -- have a native speaker check important translations")

### 17. Judge Calibration Transparency

Show aggregate statistics on how reviewers typically score: "Claude's average score is 7.8, Gemini's is 6.9." This helps users understand that reviewer scores are relative, not absolute, and that some reviewers are systematically harsher or more lenient. This kind of meta-information builds genuine AI literacy.

### 18. Mobile App (PWA)

Convert to a Progressive Web App with offline support, push notifications for shared chats, and home screen installation.

### 19. Admin Dashboard

Web-based dashboard for the app operator showing per-user usage, costs, error rates, and the ability to manage user limits.

---

## Completed

Items that were originally planned and have been fully implemented.

### ~~Spending Controls & Cost Guardrails~~ (was P0)

- Per-user daily rate limiting: 200 requests/day and 2,000,000 tokens/day (configurable via environment variables)
- Atomic check-and-increment via DynamoDB conditional writes with TTL-based expiration
- All providers set explicit `max_tokens` / `max_completion_tokens` (4,096 for OpenAI/Perplexity/Grok, 8,192 for Claude/Gemini, 32,000 for Claude with thinking)
- Clear user-facing error when limits are reached
- Token usage tracked per user in DynamoDB

### ~~Chat Deletion Confirmation~~ (was P0)

- Confirmation dialog before deleting a chat from the sidebar

### ~~Error Handling & User Feedback~~ (was P0)

- Provider API failures show clear error messages with provider name context
- Reviewer evaluation failures display as dismissible error chips on the affected message
- 30-second stall detection with "taking longer than expected" user notification
- WebSocket disconnection warning during active streaming
- Rate limit errors surfaced with friendly messaging
- Empty/failed responses automatically cleaned up (bot message bubble removed)

### ~~Set Sensible Token Limits on All Providers~~ (was P0)

- All five providers now set explicit output token limits (see Spending Controls above)

### ~~Reviewer Disagreement Highlighting~~ (was P1)

- "Reviewers disagree" chip with balance icon displayed when scores diverge by more than 2.5 points
- Expandable explanation in the detail view describing why disagreement is normal and encouraging users to read both explanations

### ~~Chat Renaming~~ (was P1)

- Double-click inline editing in the sidebar with edit icon on hover
- 100-character limit, saves on Enter/blur, persists to DynamoDB

### ~~Voice Input~~ (was P2)

- Microphone button next to send, using OpenAI Whisper API for transcription (not browser-native Web Speech API as originally planned -- Whisper provides better accuracy)
- Recording indicator with real-time duration timer, 120-second max
- Transcribed text appears in input field for review before sending
- Browser compatibility detection with error handling for denied permissions
- Multi-format support (WebM, MP4, WAV) with Safari fallback

### ~~Grok (xAI) Provider~~ (not in original PRD)

- Added as fifth chat provider and fourth reviewer
- Uses Grok 4.1 model with streaming support

### ~~Extended Thinking Display~~ (not in original PRD)

- Claude and Gemini responses can include "thinking" blocks showing the model's reasoning process
- Collapsible display in the UI so users can optionally inspect the model's chain of thought
- Think blocks stripped before passing content to reviewers to avoid biasing evaluations

### ~~Reviewer Follow-Up Questions~~ (not in original PRD)

- Users can ask follow-up questions about any reviewer's evaluation via a modal dialog
- Shows the original rating summary and problems as context
- Follow-up answers are persisted to DynamoDB alongside the original evaluation

### ~~Math & Table Rendering~~ (not in original PRD)

- LaTeX math rendering via KaTeX (inline and block)
- Markdown table support via remark-gfm

### ~~User Preferences Infrastructure~~ (not in original PRD)

- Generic key-value preference storage with localStorage caching and DynamoDB backend
- Context-based API (`useUserPreferences` hook) for frontend consumption
- Supports onboarding completion state, reviewer selection persistence, and future feature flags

### ~~Incognito Mode~~ (not in original PRD)

- Ephemeral chat sessions that are not persisted to DynamoDB
- Useful for sensitive queries users don't want saved

### ~~User-Facing Terminology Rename~~ (not in original PRD)

- User-facing strings renamed from "judge" to "reviewer" for clarity (internal code still uses "judge" in variable names and file paths)

---

## Technical Notes

### Current Architecture Strengths
- Serverless backend (Lambda + DynamoDB + AppSync) scales automatically
- Streaming via AppSync WebSocket subscriptions works well
- Provider abstraction makes adding new LLMs straightforward (demonstrated by Grok addition)
- Clerk handles auth complexity with JWT-based AppSync integration
- DynamoDB single-table design is cost-efficient
- Per-user rate limiting with atomic DynamoDB operations prevents cost overruns
- User preferences system provides a flexible foundation for feature flags and onboarding state
- Extended thinking support adds transparency to model reasoning
- Reviewer-specific instruction modules allow tuning evaluation behavior per model

### Architecture Gaps to Address
- Message schema is string-only (`content: string`) -- needs refactoring for multimodal support (file/image upload)
- No retry logic for transient provider failures
- No CloudWatch dashboards or billing alarms configured yet
- No WAF rules for public exposure
- No dead-letter queues for failed Lambda invocations

### Infrastructure Recommendations
- Add CloudWatch dashboards and billing alarms before sharing
- Add WAF rules if exposing publicly
- Set up dead-letter queues for failed Lambda invocations
- Consider API Gateway in front of AppSync for additional throttling controls
