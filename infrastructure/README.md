# Chatbot Infrastructure

This directory contains Terraform configuration for deploying the chatbot backend on AWS with Clerk authentication.

## Architecture

```
┌─────────────┐      GraphQL       ┌─────────────┐      Lambda       ┌─────────────┐
│   React     │  ◄──────────────►  │   AppSync   │  ◄──────────────► │   Lambda    │
│   Frontend  │    (OIDC Auth)     │   API       │    (Resolvers)    │   Functions │
└──────┬──────┘                    └──────┬──────┘                   └──────┬──────┘
       │                                  │                                 │
       ▼                                  ▼                                 │
┌─────────────┐                    ┌─────────────┐     ┌────────────────────┤
│   Clerk     │                    │   Clerk     │     ▼                    ▼
│   (Auth)    │ ──────────────────►│   (OIDC)    │  ┌─────────────┐  ┌─────────────┐
└─────────────┘   JWT Tokens       └─────────────┘  │  Secrets    │  │  LLM APIs   │
                                                    │  Manager    │  │  (OpenAI,   │
                                                    │  (API Keys) │  │  Anthropic, │
                                                    └─────────────┘  │  Gemini)    │
                                                                     └─────────────┘
```

## Components

- **AWS AppSync**: GraphQL API with OIDC authentication (Clerk) and real-time subscriptions
- **AWS Lambda**: Node.js functions for chat streaming and judge evaluations
- **AWS Secrets Manager**: Secure storage for LLM API keys
- **Clerk**: User authentication via OIDC
- **IAM Roles**: Least-privilege access policies

## Prerequisites

1. [Terraform](https://www.terraform.io/downloads.html) >= 1.0
2. [AWS CLI](https://aws.amazon.com/cli/) configured with appropriate credentials
3. [Node.js](https://nodejs.org/) >= 20.x (for Lambda builds)
4. [Clerk account](https://clerk.com/) with an application configured

## Clerk Setup

Before deploying, set up Clerk:

1. Create a Clerk application at https://dashboard.clerk.com
2. Configure sign-in methods (email, phone, Google, Facebook, Apple)
3. Note down:
   - **Publishable Key**: `pk_test_...` or `pk_live_...`
   - **Issuer URL**: Found in Clerk Dashboard > JWT Templates, typically `https://your-app.clerk.accounts.dev`
   - **Client ID**: Your Clerk application ID

## Deployment

### 1. Initialize Terraform

```bash
cd infrastructure
terraform init
```

### 2. Create a terraform.tfvars file

```bash
cat > terraform.tfvars << EOF
clerk_issuer_url = "https://your-app.clerk.accounts.dev"
clerk_client_id  = "your-clerk-client-id"
EOF
```

### 3. Review the plan

```bash
terraform plan
```

### 4. Deploy

```bash
terraform apply
```

### 5. Get outputs

```bash
# Get all outputs
terraform output

# Get AppSync URL for frontend
terraform output -raw appsync_api_url
```

### 6. Add LLM API Keys to Secrets Manager

```bash
# Get the secret name
SECRET_NAME=$(terraform output -raw secrets_manager_secret_name)

# Update the secret with your actual API keys
aws secretsmanager put-secret-value \
  --secret-id "$SECRET_NAME" \
  --secret-string '{
    "OPENAI_API_KEY": "sk-your-openai-key",
    "ANTHROPIC_API_KEY": "sk-ant-your-anthropic-key",
    "GEMINI_API_KEY": "your-gemini-key"
  }'
```

### 7. Configure Frontend

Create/update the frontend `.env` file:

```bash
# From the infrastructure directory
cat > ../.env << EOF
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your-clerk-key
VITE_APPSYNC_URL=$(terraform output -raw appsync_api_url)
VITE_AWS_REGION=us-east-1
EOF
```

## Files

| File | Description |
|------|-------------|
| `main.tf` | Terraform providers and backend configuration |
| `variables.tf` | Input variables including Clerk OIDC settings |
| `outputs.tf` | Output values |
| `appsync.tf` | AppSync API with OIDC auth and resolvers |
| `lambda.tf` | Lambda functions and build process |
| `iam.tf` | IAM roles and policies |
| `secrets.tf` | Secrets Manager configuration |
| `schema.graphql` | GraphQL schema with auth directives |
| `lambda/` | Lambda function source code |

## Lambda Functions

### Chat Function
- Handles streaming chat completions from OpenAI, Anthropic, and Gemini
- Publishes chunks via AppSync subscriptions for real-time updates
- Receives authenticated user identity from OIDC token

### Judge Function
- Evaluates response quality using LLM providers
- Returns score, explanation, and identified problems
- Receives authenticated user identity from OIDC token

## Customization

### Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region to deploy to |
| `environment` | `prod` | Environment name |
| `project_name` | `chatbot` | Project name for resource naming |
| `lambda_timeout` | `300` | Lambda timeout in seconds |
| `lambda_memory` | `512` | Lambda memory in MB |
| `clerk_issuer_url` | (required) | Clerk OIDC issuer URL |
| `clerk_client_id` | (required) | Clerk application client ID |

### Migrating to S3 Backend

To migrate Terraform state to S3:

1. Create an S3 bucket for state
2. Uncomment the S3 backend configuration in `main.tf`
3. Run `terraform init -migrate-state`

## Cleanup

To destroy all resources:

```bash
terraform destroy
```

**Warning**: This will delete all resources including Secrets Manager secrets. Make sure to backup any important data first.
