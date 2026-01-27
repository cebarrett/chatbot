# CLAUDE.md

This file provides guidance for Claude Code when working with this repository.

## Project Overview

This is a React + TypeScript chatbot application with an AWS AppSync GraphQL backend and Clerk authentication. The frontend is built with Vite and deployed to Amazon S3. The backend uses AWS Lambda functions to securely call LLM APIs (OpenAI, Anthropic, Google Gemini).

## Commands

### Frontend
- `npm run dev` - Start development server (port 5173)
- `npm run build` - TypeScript compile and Vite production build
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build
- `npm run deploy` - Deploy frontend to S3 (requires S3_BUCKET env var)

### Infrastructure
- `cd infrastructure && terraform init` - Initialize Terraform
- `cd infrastructure && terraform plan` - Preview infrastructure changes
- `cd infrastructure && terraform apply` - Deploy infrastructure
- `cd infrastructure && terraform output` - Get deployment outputs (AppSync URL, etc.)

## Architecture

### Frontend
- **Entry point**: `src/main.tsx` renders App with ClerkProvider into `#root`
- **Main component**: `src/App.tsx` wrapped with AuthLayout for protected routes
- **Auth components**: `src/components/AuthLayout.tsx` - Clerk sign-in/sign-out UI
- **Build output**: `dist/` directory
- **Static assets**: `public/` (copied as-is to build)

### Authentication (Clerk)
- **Provider**: `ClerkProvider` wraps the app in `main.tsx`
- **Auth context**: `src/contexts/AuthContext.tsx` - Sets up AppSync token provider
- **Protected routes**: `AuthLayout` shows sign-in for unauthenticated users
- **User button**: Clerk's `UserButton` component in the header

### Backend (infrastructure/)
- **AppSync API**: GraphQL API with OIDC authentication (Clerk) and real-time subscriptions
- **Lambda Functions**: Node.js/TypeScript handlers for chat and judge operations
- **Secrets Manager**: Secure storage for LLM API keys
- **IAM Roles**: Least-privilege access policies

### Key Services
- `src/services/appsyncClient.ts` - GraphQL client with JWT auth and WebSocket subscriptions
- `src/services/appsyncChat.ts` - Chat streaming via AppSync
- `src/services/appsyncJudge.ts` - Judge evaluations via AppSync
- `src/services/chatProviderRegistry.ts` - Provider configuration
- `src/services/judgeRegistry.ts` - Judge configuration

### GraphQL Operations
- `src/graphql/operations.ts` - Queries, mutations, and subscriptions
- `infrastructure/schema.graphql` - GraphQL schema with OIDC/IAM auth directives

## Code Style

- TypeScript strict mode enabled
- ESLint with React hooks plugin
- Functional components with hooks
- CSS modules or plain CSS files alongside components

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

- Components: PascalCase (e.g., `MyComponent.tsx`)
- Utilities: camelCase (e.g., `helpers.ts`)
- Styles: Same name as component (e.g., `App.css` for `App.tsx`)
- Lambda handlers: camelCase (e.g., `chat.ts`, `judge.ts`)
- Terraform files: lowercase with hyphens (e.g., `main.tf`, `lambda.tf`)
