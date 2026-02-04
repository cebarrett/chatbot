# Secrets Manager for LLM API keys
resource "aws_secretsmanager_secret" "llm_api_keys" {
  name        = "${var.project_name}-${var.environment}-llm-api-keys"
  description = "API keys for LLM providers (OpenAI, Anthropic, Google)"

  tags = {
    Name = "${var.project_name}-llm-api-keys"
  }
}

# Initial secret value (placeholder - update manually after deployment)
resource "aws_secretsmanager_secret_version" "llm_api_keys" {
  secret_id = aws_secretsmanager_secret.llm_api_keys.id
  secret_string = jsonencode({
    OPENAI_API_KEY      = "placeholder-add-your-key"
    ANTHROPIC_API_KEY   = "placeholder-add-your-key"
    GEMINI_API_KEY      = "placeholder-add-your-key"
    PERPLEXITY_API_KEY  = "placeholder-add-your-key"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
