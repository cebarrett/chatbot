output "appsync_api_id" {
  description = "AppSync API ID"
  value       = aws_appsync_graphql_api.chatbot.id
}

output "appsync_api_url" {
  description = "AppSync GraphQL endpoint URL"
  value       = aws_appsync_graphql_api.chatbot.uris["GRAPHQL"]
}

output "appsync_realtime_url" {
  description = "AppSync Realtime WebSocket endpoint URL"
  value       = aws_appsync_graphql_api.chatbot.uris["REALTIME"]
}

# Note: API key removed - using Clerk OIDC authentication

output "secrets_manager_secret_arn" {
  description = "Secrets Manager ARN for LLM API keys"
  value       = aws_secretsmanager_secret.llm_api_keys.arn
}

output "secrets_manager_secret_name" {
  description = "Secrets Manager name for LLM API keys"
  value       = aws_secretsmanager_secret.llm_api_keys.name
}

output "chat_lambda_function_name" {
  description = "Chat Lambda function name"
  value       = aws_lambda_function.chat.function_name
}

output "judge_lambda_function_name" {
  description = "Judge Lambda function name"
  value       = aws_lambda_function.judge.function_name
}
