# Chatbot Infrastructure

This directory contains Terraform configuration for deploying the chatbot backend on AWS.

## Architecture

```
┌─────────────┐      GraphQL       ┌─────────────┐      Lambda       ┌─────────────┐
│   React     │  ◄──────────────►  │   AppSync   │  ◄──────────────► │   Lambda    │
│   Frontend  │    (Queries &      │   API       │    (Resolvers)    │   Functions │
└─────────────┘    Subscriptions)  └─────────────┘                   └──────┬──────┘
                                                                            │
                                          ┌─────────────────────────────────┤
                                          ▼                                 ▼
                                   ┌─────────────┐                  ┌─────────────┐
                                   │  Secrets    │                  │  LLM APIs   │
                                   │  Manager    │                  │  (OpenAI,   │
                                   │  (API Keys) │                  │  Anthropic, │
                                   └─────────────┘                  │  Gemini)    │
                                                                    └─────────────┘
```

## Components

- **AWS AppSync**: GraphQL API with real-time WebSocket subscriptions
- **AWS Lambda**: Node.js functions for chat streaming and judge evaluations
- **AWS Secrets Manager**: Secure storage for LLM API keys
- **IAM Roles**: Least-privilege access policies

## Prerequisites

1. [Terraform](https://www.terraform.io/downloads.html) >= 1.0
2. [AWS CLI](https://aws.amazon.com/cli/) configured with appropriate credentials
3. [Node.js](https://nodejs.org/) >= 20.x (for Lambda builds)

## Deployment

### 1. Initialize Terraform

```bash
cd infrastructure
terraform init
```

### 2. Review the plan

```bash
terraform plan
```

### 3. Deploy

```bash
terraform apply
```

### 4. Get outputs

```bash
# Get all outputs
terraform output

# Get specific values for frontend configuration
terraform output -raw appsync_api_url
terraform output -raw appsync_api_key
```

### 5. Add LLM API Keys to Secrets Manager

After deployment, add your API keys to Secrets Manager:

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

### 6. Configure Frontend

Create/update the frontend `.env` file:

```bash
# From the infrastructure directory
cat > ../.env << EOF
VITE_APPSYNC_URL=$(terraform output -raw appsync_api_url)
VITE_APPSYNC_API_KEY=$(terraform output -raw appsync_api_key)
VITE_AWS_REGION=us-east-1
EOF
```

## Files

| File | Description |
|------|-------------|
| `main.tf` | Terraform providers and backend configuration |
| `variables.tf` | Input variables |
| `outputs.tf` | Output values |
| `appsync.tf` | AppSync API and resolvers |
| `lambda.tf` | Lambda functions and build process |
| `iam.tf` | IAM roles and policies |
| `secrets.tf` | Secrets Manager configuration |
| `schema.graphql` | GraphQL schema |
| `lambda/` | Lambda function source code |

## Lambda Functions

### Chat Function
- Handles streaming chat completions from OpenAI, Anthropic, and Gemini
- Publishes chunks via AppSync subscriptions for real-time updates

### Judge Function
- Evaluates response quality using LLM providers
- Returns score, explanation, and identified problems

## Customization

### Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region to deploy to |
| `environment` | `prod` | Environment name |
| `project_name` | `chatbot` | Project name for resource naming |
| `lambda_timeout` | `300` | Lambda timeout in seconds |
| `lambda_memory` | `512` | Lambda memory in MB |

Override variables:

```bash
terraform apply -var="environment=dev" -var="lambda_memory=1024"
```

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
