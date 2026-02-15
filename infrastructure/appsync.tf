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

# Data source for Judge Follow-Up Lambda
resource "aws_appsync_datasource" "judge_follow_up_lambda" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "JudgeFollowUpLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.judge_follow_up.arn
  }
}

# Resolver for judgeFollowUp mutation
resource "aws_appsync_resolver" "judge_follow_up" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Mutation"
  field       = "judgeFollowUp"
  data_source = aws_appsync_datasource.judge_follow_up_lambda.name

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

# ==========================================
# Chat History - DynamoDB Data Source
# ==========================================

resource "aws_appsync_datasource" "dynamodb_chats" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "DynamoDBChats"
  type             = "AMAZON_DYNAMODB"
  service_role_arn = aws_iam_role.appsync_dynamodb.arn

  dynamodb_config {
    table_name = aws_dynamodb_table.chats.name
    region     = var.aws_region
  }
}

# Data source for deleteChat Lambda
resource "aws_appsync_datasource" "delete_chat_lambda" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "DeleteChatLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.delete_chat.arn
  }
}

# Data source for createChat Lambda
resource "aws_appsync_datasource" "create_chat_lambda" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "CreateChatLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.create_chat.arn
  }
}

# Data source for listChats Lambda
resource "aws_appsync_datasource" "list_chats_lambda" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "ListChatsLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.list_chats.arn
  }
}

# ==========================================
# Chat History - listChats Query Resolver (Lambda)
# Uses Lambda to resolve internal user ID before querying
# ==========================================

resource "aws_appsync_resolver" "list_chats" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Query"
  field       = "listChats"
  data_source = aws_appsync_datasource.list_chats_lambda.name

  request_template = <<-EOF
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

  response_template = <<-EOF
$util.toJson($context.result)
EOF
}

# ==========================================
# Chat History - getChat Query Resolver (Pipeline)
# ==========================================

resource "aws_appsync_resolver" "get_chat" {
  api_id = aws_appsync_graphql_api.chatbot.id
  type   = "Query"
  field  = "getChat"
  kind   = "PIPELINE"

  pipeline_config {
    functions = [
      aws_appsync_function.get_chat_meta.function_id,
      aws_appsync_function.get_chat_messages.function_id,
    ]
  }

  request_template  = "{}"
  response_template = "$util.toJson($ctx.result)"
}

resource "aws_appsync_function" "get_chat_meta" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "getChatMeta"

  request_mapping_template  = file("${path.module}/resolvers/getChat.meta.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/getChat.meta.res.vtl")
}

resource "aws_appsync_function" "get_chat_messages" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "getChatMessages"

  request_mapping_template  = file("${path.module}/resolvers/getChat.messages.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/getChat.messages.res.vtl")
}

# ==========================================
# Chat History - createChat Mutation Resolver (Lambda)
# Uses Lambda to resolve/create internal user ID
# ==========================================

resource "aws_appsync_resolver" "create_chat" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Mutation"
  field       = "createChat"
  data_source = aws_appsync_datasource.create_chat_lambda.name

  request_template = <<-EOF
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

  response_template = <<-EOF
$util.toJson($context.result)
EOF
}

# ==========================================
# Chat History - updateChat Mutation Resolver (Pipeline)
# ==========================================

resource "aws_appsync_resolver" "update_chat" {
  api_id = aws_appsync_graphql_api.chatbot.id
  type   = "Mutation"
  field  = "updateChat"
  kind   = "PIPELINE"

  pipeline_config {
    functions = [
      aws_appsync_function.update_chat_auth.function_id,
      aws_appsync_function.update_chat_update.function_id,
      aws_appsync_function.update_chat_update_index.function_id,
    ]
  }

  request_template  = "{}"
  response_template = "$util.toJson($ctx.result)"
}

resource "aws_appsync_function" "update_chat_auth" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "updateChatAuth"

  request_mapping_template  = file("${path.module}/resolvers/updateChat.auth.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/updateChat.auth.res.vtl")
}

resource "aws_appsync_function" "update_chat_update" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "updateChatUpdate"

  request_mapping_template  = file("${path.module}/resolvers/updateChat.update.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/updateChat.update.res.vtl")
}

resource "aws_appsync_function" "update_chat_update_index" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "updateChatUpdateIndex"

  request_mapping_template  = replace(file("${path.module}/resolvers/updateChat.updateIndex.req.vtl"), "$${tableName}", aws_dynamodb_table.chats.name)
  response_mapping_template = file("${path.module}/resolvers/updateChat.updateIndex.res.vtl")
}

# ==========================================
# Chat History - deleteChat Mutation Resolver (Lambda)
# ==========================================

resource "aws_appsync_resolver" "delete_chat" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Mutation"
  field       = "deleteChat"
  data_source = aws_appsync_datasource.delete_chat_lambda.name

  request_template = <<-EOF
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

  response_template = <<-EOF
$util.toJson($context.result)
EOF
}

# ==========================================
# Chat History - saveMessage Mutation Resolver (Pipeline)
# ==========================================

resource "aws_appsync_resolver" "save_message" {
  api_id = aws_appsync_graphql_api.chatbot.id
  type   = "Mutation"
  field  = "saveMessage"
  kind   = "PIPELINE"

  pipeline_config {
    functions = [
      aws_appsync_function.save_message_auth.function_id,
      aws_appsync_function.save_message_put.function_id,
      aws_appsync_function.save_message_update_meta.function_id,
      aws_appsync_function.save_message_update_index.function_id,
    ]
  }

  request_template  = "{}"
  response_template = "$util.toJson($ctx.result)"
}

resource "aws_appsync_function" "save_message_auth" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "saveMessageAuth"

  request_mapping_template  = file("${path.module}/resolvers/saveMessage.auth.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/saveMessage.auth.res.vtl")
}

resource "aws_appsync_function" "save_message_put" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "saveMessagePut"

  request_mapping_template  = file("${path.module}/resolvers/saveMessage.put.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/saveMessage.put.res.vtl")
}

resource "aws_appsync_function" "save_message_update_meta" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "saveMessageUpdateMeta"

  request_mapping_template  = file("${path.module}/resolvers/saveMessage.updateMeta.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/saveMessage.updateMeta.res.vtl")
}

resource "aws_appsync_function" "save_message_update_index" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "saveMessageUpdateIndex"

  request_mapping_template  = replace(file("${path.module}/resolvers/saveMessage.updateIndex.req.vtl"), "$${tableName}", aws_dynamodb_table.chats.name)
  response_mapping_template = file("${path.module}/resolvers/saveMessage.updateIndex.res.vtl")
}

# ==========================================
# Chat History - updateMessage Mutation Resolver (Pipeline)
# ==========================================

resource "aws_appsync_resolver" "update_message" {
  api_id = aws_appsync_graphql_api.chatbot.id
  type   = "Mutation"
  field  = "updateMessage"
  kind   = "PIPELINE"

  pipeline_config {
    functions = [
      aws_appsync_function.update_message_auth.function_id,
      aws_appsync_function.update_message_update.function_id,
      aws_appsync_function.update_message_update_meta.function_id,
      aws_appsync_function.update_message_update_index.function_id,
    ]
  }

  request_template  = "{}"
  response_template = "$util.toJson($ctx.result)"
}

resource "aws_appsync_function" "update_message_auth" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "updateMessageAuth"

  request_mapping_template  = file("${path.module}/resolvers/updateMessage.auth.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/updateMessage.auth.res.vtl")
}

resource "aws_appsync_function" "update_message_update" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "updateMessageUpdate"

  request_mapping_template  = file("${path.module}/resolvers/updateMessage.update.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/updateMessage.update.res.vtl")
}

resource "aws_appsync_function" "update_message_update_meta" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "updateMessageUpdateMeta"

  request_mapping_template  = file("${path.module}/resolvers/updateMessage.updateMeta.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/updateMessage.updateMeta.res.vtl")
}

resource "aws_appsync_function" "update_message_update_index" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "updateMessageUpdateIndex"

  request_mapping_template  = replace(file("${path.module}/resolvers/updateMessage.updateIndex.req.vtl"), "$${tableName}", aws_dynamodb_table.chats.name)
  response_mapping_template = file("${path.module}/resolvers/updateMessage.updateIndex.res.vtl")
}

# ==========================================
# Chat History - deleteMessage Mutation Resolver (Pipeline)
# ==========================================

resource "aws_appsync_resolver" "delete_message" {
  api_id = aws_appsync_graphql_api.chatbot.id
  type   = "Mutation"
  field  = "deleteMessage"
  kind   = "PIPELINE"

  pipeline_config {
    functions = [
      aws_appsync_function.delete_message_auth.function_id,
      aws_appsync_function.delete_message_delete.function_id,
    ]
  }

  request_template  = "{}"
  response_template = "$util.toJson($ctx.result)"
}

resource "aws_appsync_function" "delete_message_auth" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "deleteMessageAuth"

  request_mapping_template  = file("${path.module}/resolvers/deleteMessage.auth.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/deleteMessage.auth.res.vtl")
}

resource "aws_appsync_function" "delete_message_delete" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  data_source = aws_appsync_datasource.dynamodb_chats.name
  name        = "deleteMessageDelete"

  request_mapping_template  = file("${path.module}/resolvers/deleteMessage.delete.req.vtl")
  response_mapping_template = file("${path.module}/resolvers/deleteMessage.delete.res.vtl")
}

# ==========================================
# User Preferences - Lambda Data Sources & Resolvers
# ==========================================

resource "aws_appsync_datasource" "get_user_preferences_lambda" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "GetUserPreferencesLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.get_user_preferences.arn
  }
}

resource "aws_appsync_datasource" "update_user_preferences_lambda" {
  api_id           = aws_appsync_graphql_api.chatbot.id
  name             = "UpdateUserPreferencesLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn

  lambda_config {
    function_arn = aws_lambda_function.update_user_preferences.arn
  }
}

resource "aws_appsync_resolver" "get_user_preferences" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Query"
  field       = "getUserPreferences"
  data_source = aws_appsync_datasource.get_user_preferences_lambda.name

  request_template = <<-EOF
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

  response_template = <<-EOF
$util.toJson($context.result)
EOF
}

resource "aws_appsync_resolver" "update_user_preferences" {
  api_id      = aws_appsync_graphql_api.chatbot.id
  type        = "Mutation"
  field       = "updateUserPreferences"
  data_source = aws_appsync_datasource.update_user_preferences_lambda.name

  request_template = <<-EOF
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

  response_template = <<-EOF
$util.toJson($context.result)
EOF
}
