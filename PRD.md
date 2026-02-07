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

Side-by-side responses from multiple providers for the same prompt, leveraging the existing multi-provider architecture. See also [19. Head-to-Head Mode](#19-head-to-head-mode-provider-duel) for a detailed design.

### 17. Mobile App (PWA)

Convert to a Progressive Web App with offline support, push notifications for shared chats, and home screen installation.

### 18. Admin Dashboard

Web-based dashboard for the app operator showing per-user usage, costs, error rates, and the ability to manage user limits.

---

## P4: LLM Evaluation Platform

These features extend the app's core differentiator — multi-provider chat with independent AI judge evaluation — into a systematic LLM comparison and evaluation platform. They build on the existing judge infrastructure and multi-provider architecture.

### 19. Head-to-Head Mode (Provider Duel)

**Problem:** Users can only chat with one provider at a time. To compare providers on the same question, they must manually create separate chats, re-type the prompt, and mentally compare results. This friction means most users never do meaningful provider comparisons.

**Requirements:**
- Select 2+ providers and send a single prompt to all simultaneously
- Display responses side-by-side in a split-pane layout, each with its own streaming indicator and judge ratings
- Fan out a single `sendMessage` mutation to multiple Lambda invocations (one per provider), all using the same conversation history and system prompt
- Show a summary row with which provider "won" per judge and overall
- Store head-to-head chats as a single chat with parallel message threads; each assistant message includes a `providerId` field
- After a duel round, let users select a "winner" to continue with or keep dueling on subsequent prompts

**Scope:**
- Phase 1: Two-provider duel with side-by-side layout, manual judge trigger
- Phase 2: N-provider support, auto-judge, cumulative scoring across a conversation

### 20. Judge Consensus & Disagreement Analysis

**Problem:** When multiple judges rate a response, users see a list of independent scores but must interpret patterns themselves. A response rated 9 by Claude and 4 by GPT raises questions the current UI doesn't help answer.

**Requirements:**
- Show a "Consensus View" when 2+ judges have rated a response, including:
  - Consensus score: weighted or median score across judges, with confidence based on agreement level
  - Agreement/disagreement summary: auto-generated explanation of where judges converge and diverge, and why
  - Disagreement flag: visual warning badge on responses where judge scores span more than 3 points
- Generate consensus via a lightweight LLM call that analyzes the set of judge explanations (a "meta-judge" — only processes judge outputs, not the original response)
- Display as a collapsible section above individual judge ratings
- Generate on-demand in the frontend; cache in React state but no DynamoDB persistence required

### 21. Provider Leaderboard & Personal Analytics

**Problem:** Users accumulate judge scores across many conversations but have no way to see aggregate trends. They can't answer "which provider performs best for my typical questions?" without manual tracking.

**Requirements:**
- Personal analytics dashboard aggregating judge scores per provider over time
- Leaderboard: providers ranked by average judge score, showing total conversations judged, average score, trend direction, and best/worst scores
- Category breakdown: auto-classify prompts (coding, writing, analysis, math, general knowledge) via a lightweight LLM call at save time; show per-category provider rankings
- Time series: chart of average judge scores per provider over last 30/90 days, highlighting significant changes
- New sidebar tab or dedicated page with charts (e.g., recharts or MUI X Charts)
- New DynamoDB GSI or query pattern for cross-chat score aggregation
- All analytics are per-user; no cross-user data exposure

### 22. Prompt Refinery

**Problem:** Users get mediocre responses due to vague prompts. The judge system identifies issues with responses but doesn't help users improve their input. Prompt iteration is manual trial and error.

**Requirements:**
- "Refine" button on judged messages that opens a refinement workflow
- New LLM call takes the original prompt, response, and all judge issues/explanations, and produces: a refined prompt, a diff highlighting changes and rationale, and predicted areas of improvement
- Modal showing original vs. refined prompt with diff highlighting and "Apply & Re-send" action
- After re-sending, show both original and refined responses with judge scores for comparison
- Store refinement history as linked messages (original → refined → refined-v2) and show a "refinement chain" in the UI
- Over time, surface common refinement patterns: "Your prompts often lack specificity — try including concrete examples"

### 23. Response Remix (Best-of-N Synthesis)

**Problem:** Different providers often excel at different aspects — one has better structure, another has more accurate facts, a third has clearer code. Users can't combine these strengths without manual copying and editing.

**Requirements:**
- "Remix" action available after receiving responses from multiple providers (via Head-to-Head or across chats)
- Meta-prompt sends all provider responses plus judge evaluations to a selected LLM, instructing it to combine the strongest aspects of each
- Synthesized response includes inline attribution indicating which provider contributed each section
- Auto-judge the synthesized response so users can compare whether the remix improved on individuals
- Depends on Head-to-Head Mode (#19) or a mechanism to select multiple responses for the same prompt

### 24. Audience Mode (Custom Judge Personas)

**Problem:** The judge system evaluates from a single perspective: general quality. But quality is audience-dependent — a response excellent for a senior engineer may be incomprehensible to a student.

**Requirements:**
- Users create custom judge personas with a name, role description, and evaluation priorities. Examples:
  - "Senior Backend Engineer" — correctness, production-readiness, error handling, performance
  - "Product Manager" — clarity, non-technical accessibility, actionable takeaways
  - "CS Student" — pedagogical value, step-by-step explanation, conceptual accuracy
  - "Security Reviewer" — vulnerability identification, input validation, secure defaults
- Personas are injected into the judge system prompt as evaluation instructions; the underlying LLM provider is still selected from existing judge providers
- Store personas per-user in DynamoDB or localStorage; support create, edit, delete
- New "Manage Personas" section in judge selector; each persona appears as a toggleable judge alongside default judges
- Ship 4-5 built-in preset personas as starting points

### 25. Conversation Forking

**Problem:** Conversations are strictly linear. Exploring "what if I'd asked differently?" or "what would another provider say here?" requires starting a new chat and manually re-creating history. This discourages exploration.

**Requirements:**
- "Fork" button on any message creates a new branch inheriting full conversation history up to that point
- Branches are lightweight: reference parent chat's messages up to the fork point, only store new messages
- Tree view (collapsible) shows conversation structure with branch points highlighted; users switch between branches
- Optionally select a different provider when forking
- Store branches as separate chats with `parentChatId` and `forkMessageId` references; new DynamoDB item type (`BRANCH#`) links branches to parents
- "Compare branches" view shows divergent responses side-by-side with judge scores

**Scope:**
- Phase 1: Single-level forking, simple branch selector UI
- Phase 2: Multi-level forking with tree visualization, branch merging

### 26. Blind Evaluation Mode

**Problem:** Users and judges may be biased by knowing which provider generated a response. A user who trusts a particular provider may unconsciously rate its responses higher, undermining objective evaluation.

**Requirements:**
- Toggle in chat settings or as a mode on Head-to-Head conversations; hides provider badge and name on assistant messages
- Responses labeled with neutral identifiers (A, B, C); mapping randomized per conversation
- "Reveal" button appears after user has reviewed all responses; unmasks identities with summary ("you preferred Provider X, which was Response B")
- Judges in blind mode don't receive provider name in their evaluation prompt
- Add a simple "prefer A or B" user rating alongside judge scores
- Blind evaluation results feed into Provider Leaderboard (#21), flagged as "blind" — arguably more reliable than open evaluations

### 27. Quality Regression Alerts

**Problem:** LLM providers update models frequently, sometimes degrading performance on specific tasks. Users have no way to detect this — a provider that was great for their use case months ago may have regressed without them noticing.

**Requirements:**
- Automatically select a representative sample of past prompts (diverse across categories, with existing judge scores) as benchmarks; users can also manually pin prompts
- Scheduled or user-triggered re-evaluation: re-send selected prompts to same providers, run same judges, compare new scores to historical scores
- Alert when a provider's average score drops more than a configurable threshold (e.g., 1.5 points) across the benchmark set; include which provider regressed, on which prompt types, by how much, and example comparisons
- Feed regression data into Provider Leaderboard (#21) as a "model stability" metric
- Cost controls: limit re-evaluation frequency (e.g., weekly) and sample size (e.g., 10 prompts/provider); clearly communicate costs before execution
- New DynamoDB item type for benchmark prompts and re-evaluation results
- Scheduled Lambda or user-triggered mutation for the re-evaluation pipeline

### 28. Exportable Evaluation Reports

**Problem:** Users evaluating LLMs for team or organizational adoption can't share findings. Judge scores, comparisons, and insights are locked in the app.

**Requirements:**
- Export formats:
  - Markdown: readable document with prompts, responses, judge scores, and commentary
  - JSON: machine-readable with full data fidelity (messages, ratings, provider metadata, timestamps)
  - PDF: formatted report with charts, score summaries, and branded layout
- Report templates:
  - Single conversation transcript with inline judge ratings
  - Head-to-head comparison with winner annotations and score differentials
  - Provider evaluation summary with aggregate scores, charts, and category breakdowns
  - Prompt battery report: run a standardized set of prompts across all providers with tabular score comparison
- "Prompt battery" workflow: define a set of test prompts, run all across all providers with judge evaluation, export as structured comparison — automated LLM benchmarking personalized to the user's use cases
- Export button on conversation view, head-to-head results, and analytics dashboard; format selector dialog

---

### Feature Dependencies

Some P4 features build on others. Recommended implementation order:

```
Independent (can start anytime):
  ├── 24. Audience Mode (Custom Judge Personas)
  ├── 22. Prompt Refinery
  └── 20. Judge Consensus & Disagreement Analysis

Depends on existing judge data accumulation:
  └── 21. Provider Leaderboard & Analytics

Depends on Head-to-Head:
  ├── 19. Head-to-Head Mode ◄── foundation
  │     ├── 23. Response Remix
  │     └── 26. Blind Evaluation Mode
  └── 28. Exportable Reports (enhanced by Head-to-Head but not blocked)

Depends on Chat History depth:
  ├── 25. Conversation Forking
  └── 27. Quality Regression Alerts (depends on 21. Analytics)
```

### Suggested P4 Prioritization

| Sub-Priority | Feature | Rationale |
|--------------|---------|-----------|
| P4-high | 19. Head-to-Head Mode | Unlocks most downstream features; highest-impact comparison capability |
| P4-high | 24. Audience Mode | Low cost (judge prompt changes only); high differentiation |
| P4-mid | 20. Judge Consensus | Adds interpretive value to existing judge output; minimal backend work |
| P4-mid | 26. Blind Evaluation | Builds on Head-to-Head; methodologically important for credible evaluation |
| P4-mid | 22. Prompt Refinery | Unique feedback loop; leverages existing judge issue data |
| P4-low | 21. Provider Leaderboard | Requires data accumulation; value grows with usage |
| P4-low | 28. Exportable Reports | High value for team adoption; moderate implementation effort |
| P4-low | 25. Conversation Forking | Compelling UX but significant persistence model changes |
| P4-low | 23. Response Remix | Novel but depends on Head-to-Head being established |
| P4-low | 27. Quality Regression Alerts | Highest complexity; requires scheduling, benchmarking, cost controls |

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
