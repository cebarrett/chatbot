# Chatbot

A multi-provider LLM chatbot with an AI judge system. Chat with OpenAI, Anthropic Claude, Google Gemini, Perplexity, and Grok, then have responses evaluated for quality by independent AI judges. Built with React, TypeScript, and AWS serverless infrastructure.

## Features

- **Multi-provider chat** - Switch between OpenAI, Claude, Gemini, Perplexity, and Grok
- **Real-time streaming** - Responses stream in via WebSocket subscriptions
- **AI judge system** - Enable multiple AI judges to rate response quality, with follow-up questions
- **Voice input** - Record audio and transcribe to text via Whisper API
- **Chat history** - Persistent chat storage with create, list, and delete
- **User preferences** - DynamoDB-backed per-user preferences with localStorage caching
- **Rate limiting** - Per-user daily request and token limits
- **Authentication** - Clerk-based sign-in with OIDC
- **Dark mode** - Light, dark, and system theme modes
- **Markdown rendering** - Messages render markdown with syntax-highlighted code blocks and LaTeX math

## Prerequisites

- Node.js 18+
- npm 9+
- AWS CLI (for deployment)
- Terraform (for infrastructure)

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment template and configure
cp .env.example .env
# Edit .env with your Clerk key and AppSync URL

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | TypeScript compile + Vite production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run deploy` | Deploy frontend to S3 |
| `npm run deploy:prod` | Deploy using S3_BUCKET from environment |

## Environment Variables

Create a `.env` file from `.env.example`:

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key from dashboard |
| `VITE_APPSYNC_URL` | Yes | AppSync GraphQL endpoint (from Terraform output) |
| `VITE_AWS_REGION` | No | AWS region (defaults to `us-east-1`) |
| `S3_BUCKET` | Deploy only | S3 bucket for frontend hosting |
| `CLOUDFRONT_DISTRIBUTION_ID` | No | CloudFront distribution for cache invalidation |

## Project Structure

```
├── public/                          # Static assets
├── src/
│   ├── __tests__/                   # Integration tests
│   ├── components/                  # React components
│   │   ├── AuthLayout.tsx           #   Clerk auth UI
│   │   ├── ChatMessage.tsx          #   Message with markdown/code rendering
│   │   ├── ChatInput.tsx            #   Message input form with voice recording
│   │   ├── ChatHistorySidebar.tsx   #   Chat list sidebar
│   │   ├── ProviderSelector.tsx     #   LLM provider picker
│   │   ├── JudgeSelector.tsx        #   Judge enable/disable
│   │   ├── JudgeFollowUpModal.tsx   #   Judge follow-up question dialog
│   │   └── ResponseQualityRating.tsx#   Judge ratings display
│   ├── config/                      # App configuration
│   │   ├── clerk.ts                 #   Clerk auth config
│   │   └── appsync.ts              #   AppSync endpoint config
│   ├── contexts/                    # React contexts
│   │   ├── AuthContext.tsx          #   Auth + AppSync token provider
│   │   ├── ThemeContext.tsx         #   Light/dark/system theme
│   │   └── UserPreferencesContext.tsx#  DynamoDB-backed user preferences
│   ├── graphql/
│   │   └── operations.ts           # GraphQL queries, mutations, subscriptions
│   ├── hooks/                       # Custom React hooks
│   │   └── useVoiceRecorder.ts     #   Voice recording + transcription
│   ├── services/                    # Business logic
│   │   ├── appsyncClient.ts        #   GraphQL client with WebSocket
│   │   ├── appsyncChat.ts          #   Chat streaming
│   │   ├── appsyncJudge.ts         #   Judge evaluations + follow-ups
│   │   ├── chatHistoryService.ts   #   Chat CRUD (DynamoDB via AppSync)
│   │   ├── chatProviderRegistry.ts #   Provider registry
│   │   ├── judgeRegistry.ts        #   Judge registry
│   │   ├── transcriptionService.ts #   Audio transcription (Whisper)
│   │   └── userPreferencesService.ts#  User preferences CRUD
│   ├── test/                        # Test setup
│   ├── types/
│   │   └── index.ts                # TypeScript type definitions
│   ├── utils/                       # Utilities
│   ├── App.tsx                      # Main application component
│   └── main.tsx                     # Entry point
├── infrastructure/                  # AWS infrastructure (Terraform)
│   ├── lambda/src/                  # Lambda function source
│   │   ├── providers/               #   LLM providers (openai, anthropic, gemini, perplexity, grok)
│   │   ├── chat.ts                  #   Chat streaming handler
│   │   ├── judge.ts                 #   Judge evaluation handler
│   │   ├── judgeFollowUp.ts        #   Judge follow-up question handler
│   │   ├── transcribe.ts           #   Audio transcription handler
│   │   ├── rateLimiter.ts          #   Per-user rate limiting
│   │   └── ...                      #   Validation, secrets, CRUD, preferences resolvers
│   ├── resolvers/                   # AppSync VTL resolver templates (~34 files)
│   ├── schema.graphql               # GraphQL schema
│   ├── appsync.tf                   # AppSync API config
│   ├── lambda.tf                    # Lambda functions
│   ├── dynamodb.tf                  # Chat history + preferences table
│   ├── secrets.tf                   # Secrets Manager (LLM API keys)
│   └── iam.tf                       # IAM roles and policies
├── scripts/
│   └── deploy.sh                    # S3 deployment script
├── docs/                            # Design documentation
├── index.html                       # HTML entry point
├── vite.config.ts                   # Vite + Vitest configuration
├── tsconfig.json                    # TypeScript configuration
└── eslint.config.js                 # ESLint configuration
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   React UI  │────▶│  AWS AppSync │────▶│  Lambda (Chat)  │──▶ LLM APIs
│  (Vite/MUI) │◀────│  (GraphQL)   │◀────│  Lambda (Judge)  │
└─────────────┘     └──────────────┘     └─────────────────┘
       │              │          │                │
       │         WebSocket    OIDC/IAM           │
   Clerk Auth    Subscriptions                    ▼
                      │              ┌─────────────────────┐
                      ▼              │  Secrets Manager     │
               ┌──────────────┐     │  (LLM API Keys)     │
               │   DynamoDB   │     └─────────────────────┘
               │ (Chat History)│
               └──────────────┘
```

- **Frontend**: React 19 + TypeScript + Vite + Material-UI
- **Auth**: Clerk OIDC tokens passed to AppSync
- **API**: AWS AppSync GraphQL with real-time WebSocket subscriptions
- **Compute**: Node.js 22 Lambda functions for chat streaming, judge evaluation, and audio transcription
- **Storage**: DynamoDB (chat history, user preferences, rate limits), Secrets Manager (API keys)
- **Providers**: OpenAI, Anthropic Claude, Google Gemini, Perplexity, Grok

## Deployment

### Infrastructure

```bash
cd infrastructure
terraform init
terraform apply
# Follow outputs to configure Secrets Manager with LLM API keys
```

See [infrastructure/README.md](infrastructure/README.md) for detailed setup.

### Frontend

```bash
# Build and deploy to S3
S3_BUCKET=your-bucket-name npm run deploy

# With CloudFront invalidation
S3_BUCKET=your-bucket CLOUDFRONT_DISTRIBUTION_ID=EXXXXX npm run deploy
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 19 |
| Language | TypeScript ~5.9 |
| Build Tool | Vite 7 |
| Component Library | Material-UI (MUI) 7 |
| Authentication | Clerk |
| API | AWS AppSync (GraphQL) |
| Compute | AWS Lambda (Node.js 22) |
| Database | AWS DynamoDB |
| Secrets | AWS Secrets Manager |
| IaC | Terraform |
| Markdown | react-markdown + react-syntax-highlighter |
| Math rendering | remark-math + rehype-katex |
| Testing | Vitest 4 + Testing Library |
| Linting | ESLint 9 |
