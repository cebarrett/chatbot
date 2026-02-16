# CLAUDE.md

This file provides guidance for Claude Code when working with this repository.

## Project Overview

This is a multi-provider LLM chatbot application with a React + TypeScript frontend and AWS serverless backend. Users can chat with multiple LLM providers (OpenAI, Anthropic Claude, Google Gemini, Perplexity, Grok) and have responses evaluated by an AI judge system. The frontend is built with Vite and Material-UI, uses Clerk for authentication, and communicates with an AWS AppSync GraphQL API. The backend uses Lambda functions that securely call LLM APIs with keys stored in Secrets Manager, and persists chat history in DynamoDB. Additional features include voice input via audio transcription, judge follow-up conversations, per-user preferences backed by DynamoDB, and per-user rate limiting.

## Commands

### Frontend
- `npm run dev` - Start development server (port 5173)
- `npm run build` - TypeScript compile and Vite production build
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build
- `npm test` - Run Vitest tests
- `npm run test:watch` - Run Vitest in watch mode
- `npm run deploy` - Deploy frontend to S3 (requires S3_BUCKET env var)
- `npm run deploy:prod` - Deploy using S3_BUCKET from environment

### Infrastructure
- `cd infrastructure && terraform init` - Initialize Terraform
- `cd infrastructure && terraform plan` - Preview infrastructure changes
- `cd infrastructure && terraform apply` - Deploy infrastructure
- `cd infrastructure && terraform output` - Get deployment outputs (AppSync URL, etc.)

### Lambda
- `cd infrastructure/lambda && npm run build` - Compile Lambda TypeScript
- `cd infrastructure/lambda && npm run clean` - Clean build output

## Architecture

### Frontend (`src/`)

- **Entry point**: `src/main.tsx` - Renders App with ClerkProvider and ThemeProvider
- **Main component**: `src/App.tsx` - Chat UI with provider selection, streaming, judge integration, chat history
- **Config**: `src/config/clerk.ts`, `src/config/appsync.ts` - Clerk and AppSync endpoint configuration
- **Types**: `src/types/index.ts` - Message, Chat, QualityRating, JudgeRatings types
- **Build output**: `dist/` directory
- **Static assets**: `public/` (copied as-is to build)

### Components (`src/components/`)
- `AuthLayout.tsx` - Clerk sign-in/sign-out UI with theme support
- `ChatMessage.tsx` - Message display with markdown rendering and code syntax highlighting
- `ChatInput.tsx` - Message input form with voice recording support
- `ChatHistorySidebar.tsx` - Chat list, creation, and deletion
- `ProviderSelector.tsx` - LLM provider selection dropdown
- `JudgeSelector.tsx` - Judge enable/disable checkboxes
- `JudgeFollowUpModal.tsx` - Modal dialog for follow-up questions about judge evaluations
- `ResponseQualityRating.tsx` - Judge quality ratings display for assistant messages

### Contexts (`src/contexts/`)
- `AuthContext.tsx` - Clerk auth integration, sets up AppSync JWT token provider
- `ThemeContext.tsx` - Light/dark/system theme mode with MUI theming
- `UserPreferencesContext.tsx` - DynamoDB-backed user preferences with localStorage cache

### Hooks (`src/hooks/`)
- `useVoiceRecorder.ts` - MediaRecorder-based voice recording with transcription via AppSync

### Services (`src/services/`)
- `appsyncClient.ts` - GraphQL client with JWT auth and WebSocket subscriptions
- `appsyncChat.ts` - Chat streaming via AppSync mutations and subscriptions
- `appsyncJudge.ts` - Judge quality evaluations and follow-up questions via AppSync
- `chatHistoryService.ts` - Chat CRUD operations (create, list, delete, save/update messages) via AppSync/DynamoDB
- `chatProviderRegistry.ts` - Provider registry (OpenAI, Claude, Gemini, Perplexity, Grok)
- `judgeRegistry.ts` - Judge registry with localStorage persistence for enabled judges
- `transcriptionService.ts` - Audio transcription via AppSync (Whisper API)
- `userPreferencesService.ts` - User preferences CRUD with localStorage write-through cache

### GraphQL
- `src/graphql/operations.ts` - Queries, mutations, subscriptions, and TypeScript types
- `infrastructure/schema.graphql` - GraphQL schema with OIDC/IAM auth directives

### Authentication (Clerk)
- `ClerkProvider` wraps the app in `main.tsx`
- `AuthContext` provides JWT tokens to the AppSync client
- `AuthLayout` shows Clerk sign-in for unauthenticated users

### Backend (`infrastructure/`)
- **AppSync API** (`appsync.tf`): GraphQL API with OIDC auth (Clerk) and IAM auth (Lambda), real-time WebSocket subscriptions
- **Lambda Functions** (`lambda.tf`): Node.js 22 TypeScript handlers for chat streaming, judge evaluation, and audio transcription
- **DynamoDB** (`dynamodb.tf`): Single-table design for chat history persistence
- **Secrets Manager** (`secrets.tf`): Secure storage for LLM API keys
- **IAM Roles** (`iam.tf`): Least-privilege policies for Lambda execution and AppSync access
- **VTL Resolvers** (`resolvers/`): ~34 Velocity Template Language files for AppSync resolver mapping

### Lambda Functions (`infrastructure/lambda/src/`)
- `index.ts` - Handler exports (chat, judge, transcribe)
- `chat.ts` - Chat handler with streaming response
- `judge.ts` - Judge handler with prompt injection protection
- `judgeFollowUp.ts` - Follow-up question handler for judge evaluations
- `judgeInstructions.ts` - Per-provider judge instruction addenda
- `transcribe.ts` - Audio transcription handler (Whisper API)
- `validation.ts` - Input validation and model allowlists
- `secrets.ts` - Secrets Manager client for LLM API keys
- `appsync.ts` - AppSync client for publishing streaming chunks
- `userService.ts` - User ID resolution (Clerk to internal mapping)
- `chunkBatcher.ts` - Streaming response chunk batching
- `rateLimiter.ts` - Per-user daily request and token rate limiting
- `types.ts` - Shared TypeScript types for Lambda handlers
- `createChat.ts`, `deleteChat.ts`, `listChats.ts` - Chat CRUD resolvers
- `getUserPreferences.ts`, `updateUserPreferences.ts`, `userPreferences.ts` - User preferences CRUD resolvers
- `providers/` - LLM provider implementations: `openai.ts`, `anthropic.ts`, `gemini.ts`, `perplexity.ts`, `grok.ts`

## Testing

- Frontend: Vitest + Testing Library (`npm test`, `npm run test:watch`)
- Lambda: Vitest (`cd infrastructure/lambda && npx vitest run`)
- Test files: `*.test.ts` / `*.test.tsx` colocated with source, plus `src/__tests__/` for integration tests
- Test setup: `src/test/setup.ts`

## Code Style

- TypeScript strict mode enabled (frontend and Lambda)
- ESLint with React hooks and React Refresh plugins
- Functional components with hooks
- Material-UI (MUI) component library with Emotion styling
- CSS files alongside components where needed

## Environment Variables

### Frontend (`.env`)
- `VITE_CLERK_PUBLISHABLE_KEY` - Clerk publishable key (required)
- `VITE_APPSYNC_URL` - AppSync GraphQL endpoint URL (required)
- `VITE_AWS_REGION` - AWS region (optional, defaults to us-east-1)

### Deployment
- `S3_BUCKET` - S3 bucket name for frontend deployment
- `CLOUDFRONT_DISTRIBUTION_ID` - CloudFront distribution for cache invalidation (optional)

### Infrastructure (`terraform.tfvars`)
- `clerk_issuer_url` - Clerk OIDC issuer URL
- `clerk_client_id` - Clerk application client ID
- `aws_region` - AWS region (defaults to us-east-1)

## Deployment

### Infrastructure Deployment
1. Set up Clerk application at https://dashboard.clerk.com
2. Navigate to `infrastructure/` directory
3. Create `terraform.tfvars` with Clerk OIDC settings
4. Run `terraform init` to initialize
5. Run `terraform apply` to deploy
6. Add LLM API keys to Secrets Manager (see outputs)
7. Copy AppSync URL to frontend `.env`

### Frontend Deployment
Deploys to S3 via `scripts/deploy.sh`. Requires:
- AWS CLI configured
- `S3_BUCKET` environment variable set
- `VITE_CLERK_PUBLISHABLE_KEY` from Clerk Dashboard
- `VITE_APPSYNC_URL` from Terraform outputs
- Optional: `CLOUDFRONT_DISTRIBUTION_ID` for CDN cache invalidation

## File Conventions

- Components: PascalCase (e.g., `ChatMessage.tsx`)
- Services/utilities: camelCase (e.g., `appsyncClient.ts`, `chatStorage.ts`)
- Config files: camelCase (e.g., `clerk.ts`, `appsync.ts`)
- Types: camelCase in `types/` directory (e.g., `index.ts`)
- Styles: Same name as component (e.g., `App.css` for `App.tsx`)
- Lambda handlers: camelCase (e.g., `chat.ts`, `judge.ts`)
- Lambda providers: lowercase (e.g., `openai.ts`, `anthropic.ts`)
- Terraform files: lowercase with hyphens (e.g., `main.tf`, `lambda.tf`)
- VTL resolvers: descriptive names in `resolvers/` (e.g., `Query.listChats.request.vtl`)
