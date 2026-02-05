# Chatbot

A multi-provider LLM chatbot with an AI judge system. Chat with OpenAI, Anthropic Claude, Google Gemini, and Perplexity, then have responses evaluated for quality by independent AI judges. Built with React, TypeScript, and AWS serverless infrastructure.

## Features

- **Multi-provider chat** - Switch between OpenAI, Claude, Gemini, and Perplexity
- **Real-time streaming** - Responses stream in via WebSocket subscriptions
- **AI judge system** - Enable multiple AI judges to rate response quality
- **Chat history** - Persistent chat storage with create, list, and delete
- **Authentication** - Clerk-based sign-in with OIDC
- **Dark mode** - Light, dark, and system theme modes
- **Markdown rendering** - Messages render markdown with syntax-highlighted code blocks

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
│   ├── components/                  # React components
│   │   ├── AuthLayout.tsx           #   Clerk auth UI
│   │   ├── ChatMessage.tsx          #   Message with markdown/code rendering
│   │   ├── ChatInput.tsx            #   Message input form
│   │   ├── ChatHistorySidebar.tsx   #   Chat list sidebar
│   │   ├── ProviderSelector.tsx     #   LLM provider picker
│   │   ├── JudgeSelector.tsx        #   Judge enable/disable
│   │   └── ResponseQualityRating.tsx#   Judge ratings display
│   ├── config/                      # App configuration
│   │   ├── clerk.ts                 #   Clerk auth config
│   │   └── appsync.ts              #   AppSync endpoint config
│   ├── contexts/                    # React contexts
│   │   ├── AuthContext.tsx          #   Auth + AppSync token provider
│   │   └── ThemeContext.tsx         #   Light/dark/system theme
│   ├── graphql/
│   │   └── operations.ts           # GraphQL queries, mutations, subscriptions
│   ├── services/                    # Business logic
│   │   ├── appsyncClient.ts        #   GraphQL client with WebSocket
│   │   ├── appsyncChat.ts          #   Chat streaming
│   │   ├── appsyncJudge.ts         #   Judge evaluations
│   │   ├── chatHistoryService.ts   #   Chat CRUD (DynamoDB via AppSync)
│   │   ├── chatProviderRegistry.ts #   Provider registry
│   │   └── judgeRegistry.ts        #   Judge registry
│   ├── types/
│   │   └── index.ts                # TypeScript type definitions
│   ├── utils/                       # Utilities
│   ├── App.tsx                      # Main application component
│   └── main.tsx                     # Entry point
├── infrastructure/                  # AWS infrastructure (Terraform)
│   ├── lambda/src/                  # Lambda function source
│   │   ├── providers/               #   LLM provider implementations
│   │   ├── chat.ts                  #   Chat streaming handler
│   │   ├── judge.ts                 #   Judge evaluation handler
│   │   └── ...                      #   Validation, secrets, CRUD resolvers
│   ├── resolvers/                   # AppSync VTL resolver templates
│   ├── schema.graphql               # GraphQL schema
│   ├── appsync.tf                   # AppSync API config
│   ├── lambda.tf                    # Lambda functions
│   ├── dynamodb.tf                  # Chat history table
│   ├── secrets.tf                   # Secrets Manager (LLM API keys)
│   └── iam.tf                       # IAM roles and policies
├── scripts/
│   └── deploy.sh                    # S3 deployment script
├── docs/                            # Design documentation
├── index.html                       # HTML entry point
├── vite.config.ts                   # Vite configuration
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
- **Compute**: Node.js 22 Lambda functions for chat streaming and judge evaluation
- **Storage**: DynamoDB (chat history), Secrets Manager (API keys)
- **Providers**: OpenAI, Anthropic Claude, Google Gemini, Perplexity

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
| Linting | ESLint 9 |
