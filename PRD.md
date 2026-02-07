# Product Requirements Document: Chatbot v2

## Overview

This document defines the requirements for making the multi-provider LLM chatbot ready to share with non-technical friends and family as a free alternative to paid AI chat services like ChatGPT Plus.

### Current State

The app is a functional multi-provider AI chatbot with a React + TypeScript frontend, AWS serverless backend, Clerk authentication, and support for OpenAI, Anthropic Claude, Google Gemini, and Perplexity. It includes a unique AI judge system that evaluates response quality, chat history persistence, streaming responses, and dark/light theme support.

### Target Audience

Non-technical users (friends and family) who currently use or would consider paying for ChatGPT, Claude, or similar services.

### Success Criteria

- Users can start chatting within 30 seconds of first visit with no confusion
- No single user can cause runaway API costs
- Errors are surfaced clearly, never silently swallowed
- Core workflows (chat, delete, edit) feel safe and forgiving

---

## P0: Must-Have (Before Sharing)

### 1. Spending Controls & Cost Guardrails

**Problem:** No rate limiting or per-user cost controls exist. One heavy user could generate hundreds of dollars in API charges. OpenAI and Perplexity providers don't set `max_tokens`, allowing arbitrarily long responses.

**Requirements:**
- Set explicit `max_tokens` on all LLM provider calls (OpenAI and Perplexity currently missing this)
- Implement per-user daily request caps (configurable, e.g. 50 messages/day)
- Implement per-user daily token budget (configurable)
- Return a clear, friendly error when a user hits their limit ("You've reached today's limit. Come back tomorrow!")
- Add an admin dashboard or at minimum CloudWatch alarms for spend monitoring
- Track token usage per user in DynamoDB

### 2. Confirmation Dialogs for Destructive Actions

**Problem:** Deleting a message or editing the last message permanently removes content with no confirmation and no undo. Non-technical users will lose conversations by accident.

**Requirements:**
- Add a confirmation dialog before deleting a message ("Delete this message and its response? This can't be undone.")
- Add a confirmation dialog before deleting a chat from the sidebar
- When editing a message, warn that the previous AI response will be replaced
- Consider adding soft-delete with a 30-day retention period

### 3. Error Handling & User Feedback

**Problem:** Errors are silent or cryptic. Provider failures show a stuck "Typing..." indicator. Judge failures are completely invisible. "Demo Mode" label is unexplained.

**Requirements:**
- When a provider API call fails, show a clear message: "Claude is temporarily unavailable. Try a different provider."
- When a judge evaluation fails, show a dismissible notice on the affected message instead of failing silently
- Add a timeout (e.g. 30 seconds) after which a stalled response shows "This is taking longer than expected. You can wait or try again."
- Remove or replace "Demo Mode" with an explicit "Not configured" state that explains what the user should do (or hide unconfigured providers entirely)
- When the WebSocket subscription drops, show a reconnection notice

### 4. Set Sensible Token Limits on All Providers

**Problem:** OpenAI and Perplexity have no `max_tokens` set, relying on provider defaults that could produce very long (and expensive) responses.

**Requirements:**
- Set `max_tokens: 4096` (or similar reasonable default) on OpenAI and Perplexity provider calls, matching Anthropic and Gemini
- Make this configurable per-provider in case different limits are desired

---

## P1: Should-Have (First Week)

### 5. First-Visit Onboarding

**Problem:** No explanation of features exists in the app. The judge system (gavel icon), provider selector, and incognito mode are undiscoverable to new users.

**Requirements:**
- Show a lightweight onboarding flow on first sign-in (3-4 steps max):
  1. "Choose your AI" -- explain provider selector and what each provider is good at
  2. "Get a second opinion" -- explain the judge system and how to read quality ratings
  3. "Go incognito" -- explain ephemeral chats
- Store completion state in localStorage so it only shows once
- Add a "?" help button in the header that re-triggers the onboarding or shows a help summary
- Add brief helper text or tooltips to the judge menu explaining what each judge does

### 6. Chat Renaming

**Problem:** Chats are auto-titled from the first message and can't be renamed. The sidebar becomes a wall of truncated, unhelpful text.

**Requirements:**
- Double-click or long-press a chat title in the sidebar to rename it
- Show a small edit icon on hover/focus for discoverability
- Limit title length to 100 characters
- Save immediately on blur or Enter key

### 7. Copy Button on Code Blocks

**Problem:** Code blocks rendered via react-syntax-highlighter have no copy mechanism. On mobile, selecting and copying code is especially painful.

**Requirements:**
- Add a "Copy" button in the top-right corner of every code block
- Show brief "Copied!" confirmation feedback
- Works on both desktop and mobile

### 8. Content Moderation

**Problem:** No input or output filtering exists. The app relies entirely on upstream LLM provider safety filters, which vary in strictness.

**Requirements:**
- Evaluate and document the safety guarantees of each provider's API
- Add an optional input filter that flags or blocks clearly inappropriate prompts before they reach the API
- At minimum, log flagged content for review
- Consider age-gating or usage agreements if minors may have access

---

## P2: Nice-to-Have (First Month)

### 9. File & Image Upload

**Problem:** ChatGPT supports uploading PDFs, images, and documents. This is one of its most-used features for casual users ("read this menu", "what's this error screenshot"). The app is text-only.

**Requirements:**
- Support image upload for vision-capable models (GPT-4o, Claude, Gemini)
- Display uploaded images inline in the chat
- Support PDF text extraction for context injection
- Show clear errors for unsupported file types or sizes
- Set file size limits (e.g. 10MB images, 20MB PDFs)

### 10. Web Search Integration

**Problem:** Perplexity has built-in search capabilities but citations are stripped out. Users asking about current events get stale or incorrect answers from other providers.

**Requirements:**
- Preserve and display Perplexity citations/sources as clickable links
- Consider adding a "Search" toggle or auto-detecting queries that need current information
- Show a visual indicator when a response includes web search results

### 11. Voice Input

**Problem:** Many casual users prefer speaking to typing, especially on mobile. ChatGPT's voice mode is heavily used.

**Requirements:**
- Add a microphone button next to the send button
- Use the Web Speech API (browser-native) for speech-to-text
- Show a recording indicator while listening
- Transcribed text appears in the input field for review before sending
- Graceful fallback for unsupported browsers

### 12. Improved Mobile Experience

**Problem:** While the app is responsive, some mobile-specific polish is missing.

**Requirements:**
- Test and fix any keyboard push-up issues on iOS and Android
- Add haptic feedback on send (where supported)
- Add swipe-to-delete on chat history items
- Test on small phones (320px), tablets, and landscape orientations
- Ensure touch targets are at least 44x44px per accessibility guidelines

### 13. Chat Sharing & Export

**Problem:** No way to share an interesting conversation or export chat history.

**Requirements:**
- "Share" button that generates a read-only link to a conversation
- Export chat as markdown or plain text
- Shared links should not require authentication to view
- Optionally redact user messages in shared view

---

## P3: Future Considerations

### 14. Custom System Prompts

Allow users to set a persistent system prompt ("You are a helpful cooking assistant") per chat or globally.

### 15. Prompt Library

Pre-built prompt templates for common tasks (summarize, translate, explain like I'm 5, proofread, etc.) to help users who don't know what to ask.

### 16. Multi-Model Comparison View

Side-by-side responses from multiple providers for the same prompt, leveraging the existing multi-provider architecture.

### 17. Mobile App (PWA)

Convert to a Progressive Web App with offline support, push notifications for shared chats, and home screen installation.

### 18. Admin Dashboard

Web-based dashboard for the app operator showing per-user usage, costs, error rates, and the ability to manage user limits.

---

## Technical Notes

### Current Architecture Strengths
- Serverless backend scales automatically
- Streaming via AppSync WebSocket subscriptions works well
- Provider abstraction makes adding new LLMs straightforward
- Clerk handles auth complexity
- DynamoDB single-table design is cost-efficient

### Architecture Gaps to Address
- No token counting or cost attribution infrastructure
- No middleware layer for rate limiting (consider API Gateway throttling or a Lambda authorizer)
- Message schema is string-only (`content: string`) -- needs refactoring for multimodal support
- No retry logic for transient provider failures
- Judge system errors are not propagated to the frontend

### Infrastructure Recommendations
- Add CloudWatch dashboards and billing alarms before sharing
- Consider API Gateway usage plans for built-in rate limiting
- Add WAF rules if exposing publicly
- Set up dead-letter queues for failed Lambda invocations
