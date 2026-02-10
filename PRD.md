# Product Requirements Document: Chatbot v2

## Overview

This document defines the requirements for making the multi-provider LLM chatbot ready to share with non-technical friends and family.

### Current State

The app is a functional multi-provider AI chatbot with a React + TypeScript frontend, AWS serverless backend, Clerk authentication, and support for OpenAI, Anthropic Claude, Google Gemini, and Perplexity. It includes a unique AI judge system that evaluates response quality, chat history persistence, streaming responses, and dark/light theme support.

### Value Proposition

This app is not just a free alternative to ChatGPT Plus. Its differentiating feature is the multi-judge system: independent AI models that critique each other's responses, surface problems, and let users ask follow-up questions about the evaluation. For non-technical users encountering AI for the first time -- or skeptical users who distrust it -- this transparency is the product.

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
- Users engage with judge ratings on at least 30% of responses (expand, read explanations, or ask follow-ups)
- Users who complete onboarding can articulate at least one limitation of AI chat (e.g., "it can make things up" or "different AIs give different answers")
- The judge system is understood as "AI checking AI," not confused for a human review or ignored entirely

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

### 5. First-Visit Onboarding with AI Literacy Framing

**Problem:** No explanation of features exists in the app. The judge system (gavel icon), provider selector, and incognito mode are undiscoverable to new users. More importantly, the app's core value -- helping users critically evaluate AI responses -- is never communicated. Users who don't understand why the judge system exists will ignore it.

**Requirements:**
- Show a lightweight onboarding flow on first sign-in (4-5 steps max):
  1. **"AI is useful, but not perfect"** -- set expectations upfront. AI chatbots can be confidently wrong, make things up, or give different answers depending on the day. This app is designed to help you see that for yourself.
  2. **"Choose your AI"** -- explain the provider selector and that each provider is a different AI system with different strengths and blind spots.
  3. **"Every response gets a second opinion"** -- explain that independent AI judges automatically review each response and flag potential problems. This is like having a fact-checker built in, though the fact-checker can be wrong too.
  4. **"Ask the judges why"** -- show that users can tap on a judge rating and ask follow-up questions like "Is this really accurate?" or "What should I verify?"
  5. **"You're the final judge"** -- close by reinforcing that the scores and evaluations are tools to help the user think, not a stamp of approval. Encourage users to question everything, including the judges.
- Store completion state in localStorage so it only shows once
- Add a "?" help button in the header that re-triggers the onboarding or shows a help summary
- Add brief helper text in the judge menu explaining what each judge does and why having multiple judges matters ("Different AI models catch different problems")

### 6. Judge Disagreement Highlighting

**Problem:** When multiple judges evaluate a response, their scores are displayed side by side with no commentary. But judge disagreement is one of the most powerful AI literacy teaching moments available: it demonstrates that AI evaluation itself is subjective and uncertain. Currently, a user seeing "Claude: 8.5" next to "Gemini: 5.0" has no prompt to think about what that gap means.

**Requirements:**
- When judge scores diverge by more than 2.5 points, display a visible "Judges disagree" indicator on the rating summary
- In the expanded view, show a brief explanation: "These AI judges evaluated this response differently. This is normal -- AI systems have different strengths and biases. Consider reading both explanations to decide for yourself."
- Use a distinct visual treatment (e.g., a contrasting chip color or icon) so users notice disagreement without needing to expand
- Track disagreement frequency in analytics to understand how often it occurs

### 7. Visible Scoring Rubric

**Problem:** The judge scoring rubric (1-3 = poor, 4-5 = below average, 6-7 = average, 8-9 = good, 9-10 = excellent) and the evaluation criteria (accuracy, helpfulness, completeness, clarity) are buried in the Lambda system prompt. Users see a number like "7.5" with no context for what it means or what the judge was looking for.

**Requirements:**
- Add a "How scoring works" expandable section accessible from the rating area (e.g., a small "?" icon next to the score)
- Show the score scale with descriptions (Poor / Below Average / Average / Good / Excellent)
- List the evaluation dimensions: accuracy, helpfulness, completeness, and clarity
- Keep it brief -- a single compact card, not a wall of text
- This helps users internalize the criteria and develop their own evaluation instincts over time

### 8. Chat Renaming

**Problem:** Chats are auto-titled from the first message and can't be renamed. The sidebar becomes a wall of truncated, unhelpful text.

**Requirements:**
- Double-click or long-press a chat title in the sidebar to rename it
- Show a small edit icon on hover/focus for discoverability
- Limit title length to 100 characters
- Save immediately on blur or Enter key

### 9. Copy Button on Code Blocks

**Problem:** Code blocks rendered via react-syntax-highlighter have no copy mechanism. On mobile, selecting and copying code is especially painful.

**Requirements:**
- Add a "Copy" button in the top-right corner of every code block
- Show brief "Copied!" confirmation feedback
- Works on both desktop and mobile

### 10. Content Moderation

**Problem:** No input or output filtering exists. The app relies entirely on upstream LLM provider safety filters, which vary in strictness.

**Requirements:**
- Evaluate and document the safety guarantees of each provider's API
- Add an optional input filter that flags or blocks clearly inappropriate prompts before they reach the API
- At minimum, log flagged content for review
- Consider age-gating or usage agreements if minors may have access

### 11. Multi-Model Comparison View

**Problem:** Nothing teaches "AI is not an oracle" faster than seeing three different models give three different answers to the same question. The existing multi-provider architecture already supports this, but users can only talk to one provider at a time.

**Requirements:**
- Add a "Compare" mode that sends the same prompt to 2-3 selected providers simultaneously
- Display responses side by side (desktop) or stacked with clear provider labels (mobile)
- Each response gets its own judge evaluations
- Highlight differences between responses (even a simple "Responses differ" notice is valuable)
- Frame this feature in the UI as a learning tool: "See how different AIs answer the same question"

**AI literacy value:** This is one of the highest-impact features for shifting users' mental model from "AI gives me the answer" to "AI gives me an answer." When users see three confident, well-written, but contradictory responses, the lesson is immediate and visceral.

---

## P2: Nice-to-Have (First Month)

### 12. Hallucination-Specific Evaluation

**Problem:** The current judge system evaluates general quality (accuracy, helpfulness, completeness, clarity) but doesn't specifically flag hallucinated content. The `problems` array can contain anything. If teaching users to watch for hallucinations is a core goal, the judge system needs to call this out explicitly.

**Requirements:**
- Add a hallucination-focused evaluation dimension to the judge system prompt, asking judges to specifically identify:
  - Claims that cannot be verified or are likely fabricated
  - Invented citations, statistics, or sources
  - Confident statements about topics where the model is likely guessing
- Display hallucination warnings distinctly in the UI, separate from general quality issues (e.g., a "Verify this" label or icon on flagged claims)
- Consider a simple "Confidence" indicator alongside the quality score: "The judge thinks some claims in this response may need verification"
- This should complement, not replace, the existing general quality evaluation

### 13. Suggested Follow-Up Questions for Judges

**Problem:** The follow-up question feature (asking a judge "why did you rate this a 7?") is one of the most valuable AI literacy tools in the app, but it requires users to know what to ask. Non-technical users may not engage with it because they don't have a question in mind.

**Requirements:**
- Pre-populate 2-3 suggested follow-up questions below the judge's explanation, tailored to the rating context:
  - For low scores: "What's wrong with this response?" / "How could I get a better answer?"
  - For high scores: "Is there anything I should double-check?" / "What's missing from this answer?"
  - General: "Could this response be misleading?" / "How confident should I be in this?"
- Suggested questions appear as tappable chips, not a dropdown or menu
- Tapping a chip submits it immediately (same as typing and sending a follow-up)
- This dramatically lowers the barrier to engaging with the judge system

### 14. Persistent AI Literacy Nudges

**Problem:** Even with good onboarding, users will forget the critical evaluation mindset after a few sessions. The app needs subtle, ongoing reminders that AI responses should be questioned.

**Requirements:**
- Add a subtle, non-intrusive caveat beneath each AI response: "AI responses may contain errors. Tap the ratings below for a second opinion." This should be visually muted (small, low-contrast text) so it doesn't dominate the UI, but present enough to normalize the idea that verification is expected.
- Periodically (e.g., every 10th message), show a slightly more prominent tip: "Did you know? Different AI models often disagree with each other. Try switching providers to compare answers."
- These nudges should be dismissible per-session and respect a "don't show again" preference
- The tone should be helpful and empowering, never condescending: "Here's how to get more out of this" rather than "Be careful, AI is dangerous"

### 15. Example Conversations

**Problem:** Non-technical users landing in an empty chat may not know what to ask, and won't see the judge system in action until they send a message. Pre-loaded examples could demonstrate the app's value immediately.

**Requirements:**
- Offer 2-3 pre-loaded example conversations accessible from the empty chat state:
  - One where a response got a high score with a clean evaluation
  - One where a response got a low score with clear problems identified (e.g., a hallucinated fact)
  - One showing judge disagreement, with the user asking a follow-up question
- These should be clearly labeled as examples ("See how it works") and not mixed into the user's chat history
- Users can dismiss them and start fresh at any time

### 16. File & Image Upload

**Problem:** ChatGPT supports uploading PDFs, images, and documents. This is one of its most-used features for casual users ("read this menu", "what's this error screenshot"). The app is text-only.

**Requirements:**
- Support image upload for vision-capable models (GPT-4o, Claude, Gemini)
- Display uploaded images inline in the chat
- Support PDF text extraction for context injection
- Show clear errors for unsupported file types or sizes
- Set file size limits (e.g. 10MB images, 20MB PDFs)

### 17. Web Search Integration

**Problem:** Perplexity has built-in search capabilities but citations are stripped out. Users asking about current events get stale or incorrect answers from other providers.

**Requirements:**
- Preserve and display Perplexity citations/sources as clickable links
- Consider adding a "Search" toggle or auto-detecting queries that need current information
- Show a visual indicator when a response includes web search results

### 18. Voice Input

**Problem:** Many casual users prefer speaking to typing, especially on mobile. ChatGPT's voice mode is heavily used.

**Requirements:**
- Add a microphone button next to the send button
- Use the Web Speech API (browser-native) for speech-to-text
- Show a recording indicator while listening
- Transcribed text appears in the input field for review before sending
- Graceful fallback for unsupported browsers

### 19. Improved Mobile Experience

**Problem:** While the app is responsive, some mobile-specific polish is missing.

**Requirements:**
- Test and fix any keyboard push-up issues on iOS and Android
- Add haptic feedback on send (where supported)
- Add swipe-to-delete on chat history items
- Test on small phones (320px), tablets, and landscape orientations
- Ensure touch targets are at least 44x44px per accessibility guidelines

### 20. Chat Sharing & Export

**Problem:** No way to share an interesting conversation or export chat history.

**Requirements:**
- "Share" button that generates a read-only link to a conversation
- Export chat as markdown or plain text
- Shared links should not require authentication to view
- Optionally redact user messages in shared view

---

## P3: Future Considerations

### 21. Custom System Prompts

Allow users to set a persistent system prompt ("You are a helpful cooking assistant") per chat or globally.

### 22. Prompt Library with AI Literacy Templates

Pre-built prompt templates, but framed around critical thinking rather than just productivity:
- **"Test the AI"** prompts that are known to produce hallucinations or inconsistencies (e.g., asking for fake citations, asking about very recent events, asking for medical/legal advice)
- **"Compare answers"** templates that encourage sending the same question to multiple providers
- **Everyday tasks:** summarize, translate, explain like I'm 5, proofread -- with tips on verifying the output
- Each template should include a brief note on what to watch out for ("AI translations can miss cultural nuance -- have a native speaker check important translations")

### 23. Judge Calibration Transparency

Show aggregate statistics on how judges typically score: "Claude's average score is 7.8, Gemini's is 6.9." This helps users understand that judge scores are relative, not absolute, and that some judges are systematically harsher or more lenient. This kind of meta-information builds genuine AI literacy.

### 24. Mobile App (PWA)

Convert to a Progressive Web App with offline support, push notifications for shared chats, and home screen installation.

### 25. Admin Dashboard

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
