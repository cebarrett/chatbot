# AppSync GraphQL API with Clerk OIDC authentication
resource "aws_appsync_graphql_api" "chatbot" {
  name                = "${var.project_name}-${var.environment}-api"
  authentication_type = "OPENID_CONNECT"

  openid_connect_config {
    issuer = var.clerk_issuer_url
  }

  # Additional auth for Lambda to call publishChunk mutation
  additional_authentication_provider {
    authentication_type = "AWS_IAM"
  }

  schema = file("${path.module}/schema.graphql")

  log_config {
    cloudwatch_logs_role_arn = aws_iam_role.appsync_logs.arn
    field_log_level          = "ERROR"
  }

  tags = {
    Name = "${var.project_name}-api"
  }
}

# IAM role for AppSync CloudWatch Logs
resource "aws_iam_role" "appsync_logs" {
  name = "${var.project_name}-${var.environment}-appsync-logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "appsync.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "appsync_logs" {
  role       = aws_iam_role.appsync_logs.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppSyncPushToCloudWatchLogs"
}

# Data source for Chat Lambda
resource "aws_appsync_datasource" "chat_lambda" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "ChatLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.chat.arn
  }
}

# Data source for Judge Lambda
resource "aws_appsync_datasource" "judge_lambda" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "JudgeLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.judge.arn
  }
}

# Data source for local resolvers (NONE type)
resource "aws_appsync_datasource" "none" {
  api_id = aws_appsync_graphql_api.chatbot.id
  name   = "None"
  type   = "NONE"
}

# Resolver for health query
resource "aws_appsync_resolver" "health" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Query"
  field       = "health"
  data_source = aws_appsync_datasource.none.name

  request_template = <<EOF
{
  "version": "2017-02-28",
  "payload": {}
}
EOF

  response_template = <<EOF
"ok"
EOF
}

# Resolver for sendMessage mutation
resource "aws_appsync_resolver" "send_message" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Mutation"
  field       = "sendMessage"
  data_source = aws_appsync_datasource.chat_lambda.name

  request_template = <<EOF
{
  "version": "2017-02-28",
  "operation": "Invoke",
  "payload": {
    "arguments": $util.toJson($context.arguments),
    "identity": {
      "sub": "$context.identity.sub",
      "issuer": "$context.identity.issuer",
      "claims": $util.toJson($context.identity.claims)
    }
  }
}
EOF

  response_template = <<EOF
$util.toJson($context.result)
EOF
}

# Resolver for publishChunk mutation (used by Lambda to publish to subscribers)
resource "aws_appsync_resolver" "publish_chunk" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Mutation"
  field       = "publishChunk"
  data_source = aws_appsync_datasource.none.name

  request_template = <<EOF
{
  "version": "2017-02-28",
  "payload": $util.toJson($context.arguments)
}
EOF

  response_template = <<EOF
$util.toJson($context.result)
EOF
}

# Resolver for judgeResponse mutation
resource "aws_appsync_resolver" "judge_response" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Mutation"
  field       = "judgeResponse"
  data_source = aws_appsync_datasource.judge_lambda.name

  request_template = <<EOF
{
  "version": "2017-02-28",
  "operation": "Invoke",
  "payload": {
    "arguments": $util.toJson($context.arguments),
    "identity": {
      "sub": "$context.identity.sub",
      "issuer": "$context.identity.issuer",
      "claims": $util.toJson($context.identity.claims)
    }
  }
}
EOF

  response_template = <<EOF
$util.toJson($context.result)
EOF
}
