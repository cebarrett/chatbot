# CLAUDE.md

This file provides guidance for Claude Code when working with this repository.

## Project Overview

This is a React + TypeScript chatbot application with an AWS AppSync GraphQL backend. The frontend is built with Vite and deployed to Amazon S3. The backend uses AWS Lambda functions to securely call LLM APIs (OpenAI, Anthropic, Google Gemini).

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
- `cd infrastructure && terraform output` - Get deployment outputs (AppSync URL, API key, etc.)

## Architecture

### Frontend
- **Entry point**: `src/main.tsx` renders App into `#root`
- **Main component**: `src/App.tsx`
- **Build output**: `dist/` directory
- **Static assets**: `public/` (copied as-is to build)

### Backend (infrastructure/)
- **AppSync API**: GraphQL API with real-time subscriptions
- **Lambda Functions**: Node.js/TypeScript handlers for chat and judge operations
- **Secrets Manager**: Secure storage for LLM API keys
- **IAM Roles**: Least-privilege access policies

### Key Services
- `src/services/appsyncClient.ts` - GraphQL client with WebSocket subscriptions
- `src/services/appsyncChat.ts` - Chat streaming via AppSync
- `src/services/appsyncJudge.ts` - Judge evaluations via AppSync
- `src/services/chatProviderRegistry.ts` - Provider configuration
- `src/services/judgeRegistry.ts` - Judge configuration

### GraphQL Operations
- `src/graphql/operations.ts` - Queries, mutations, and subscriptions
- `infrastructure/schema.graphql` - GraphQL schema definition

## Code Style

- TypeScript strict mode enabled
- ESLint with React hooks plugin
- Functional components with hooks
- CSS modules or plain CSS files alongside components

## Deployment

### Infrastructure Deployment
1. Navigate to `infrastructure/` directory
2. Run `terraform init` to initialize
3. Run `terraform apply` to deploy
4. Add LLM API keys to Secrets Manager (see outputs)
5. Copy AppSync URL and API key to frontend `.env`

### Frontend Deployment
Deploys to S3 via `scripts/deploy.sh`. Requires:
- AWS CLI configured
- `S3_BUCKET` environment variable set
- `VITE_APPSYNC_URL` and `VITE_APPSYNC_API_KEY` from Terraform outputs
- Optional: `CLOUDFRONT_DISTRIBUTION_ID` for CDN cache invalidation

## File Conventions

- Components: PascalCase (e.g., `MyComponent.tsx`)
- Utilities: camelCase (e.g., `helpers.ts`)
- Styles: Same name as component (e.g., `App.css` for `App.tsx`)
- Lambda handlers: camelCase (e.g., `chat.ts`, `judge.ts`)
- Terraform files: lowercase with hyphens (e.g., `main.tf`, `lambda.tf`)
