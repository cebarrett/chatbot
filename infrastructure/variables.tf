variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "chatbot"
}

variable "lambda_timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 300 # 5 minutes for LLM streaming
}

variable "lambda_memory" {
  description = "Lambda function memory in MB"
  type        = number
  default     = 512
}

# Clerk OIDC Configuration
variable "clerk_issuer_url" {
  description = "Clerk OIDC issuer URL (e.g., https://clerk.your-domain.com or https://your-instance.clerk.accounts.dev)"
  type        = string
}

variable "clerk_client_id" {
  description = "Clerk application client ID"
  type        = string
}

# Rate limiting configuration
variable "rate_limit_daily_requests" {
  description = "Maximum number of LLM API requests per user per day"
  type        = number
  default     = 50
}

variable "rate_limit_daily_tokens" {
  description = "Maximum number of tokens per user per day (soft limit)"
  type        = number
  default     = 500000
}

# CloudWatch alarm configuration
variable "alarm_notification_email" {
  description = "Email address for CloudWatch alarm notifications (leave empty to skip)"
  type        = string
  default     = ""
}

variable "alarm_chat_invocations_per_hour" {
  description = "Threshold for chat Lambda invocations per hour alarm"
  type        = number
  default     = 1000
}

variable "alarm_judge_invocations_per_hour" {
  description = "Threshold for judge Lambda invocations per hour alarm"
  type        = number
  default     = 2000
}
