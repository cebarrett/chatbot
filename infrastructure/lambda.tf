# Build Lambda deployment package
data "archive_file" "lambda_package" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/dist"
  output_path = "${path.module}/lambda/package.zip"

  depends_on = [null_resource.lambda_build]
}

# Build Lambda TypeScript code
resource "null_resource" "lambda_build" {
  triggers = {
    source_hash = sha256(join("", [
      for f in fileset("${path.module}/lambda/src", "**/*.ts") :
      filesha256("${path.module}/lambda/src/${f}")
    ]))
    package_hash = filesha256("${path.module}/lambda/package.json")
  }

  provisioner "local-exec" {
    command     = "npm ci && npm run build"
    working_dir = "${path.module}/lambda"
  }
}

# Chat Lambda function
resource "aws_lambda_function" "chat" {
  filename         = data.archive_file.lambda_package.output_path
  function_name    = "${var.project_name}-${var.environment}-chat"
  role             = aws_iam_role.lambda_execution.arn
  handler          = "chat.handler"
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  runtime          = "nodejs22.x"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory

  environment {
    variables = {
      SECRETS_NAME               = aws_secretsmanager_secret.llm_api_keys.name
      APPSYNC_URL                = aws_appsync_graphql_api.chatbot.uris["GRAPHQL"]
      DYNAMODB_TABLE_NAME        = aws_dynamodb_table.chats.name
      RATE_LIMIT_DAILY_REQUESTS  = tostring(var.rate_limit_daily_requests)
      RATE_LIMIT_DAILY_TOKENS    = tostring(var.rate_limit_daily_tokens)
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_secrets_access,
    aws_iam_role_policy.lambda_appsync_access,
    aws_iam_role_policy.lambda_dynamodb_access,
  ]

  tags = {
    Name = "${var.project_name}-chat"
  }
}

# Judge Lambda function
resource "aws_lambda_function" "judge" {
  filename         = data.archive_file.lambda_package.output_path
  function_name    = "${var.project_name}-${var.environment}-judge"
  role             = aws_iam_role.lambda_execution.arn
  handler          = "judge.handler"
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  runtime          = "nodejs22.x"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory

  environment {
    variables = {
      SECRETS_NAME               = aws_secretsmanager_secret.llm_api_keys.name
      DYNAMODB_TABLE_NAME        = aws_dynamodb_table.chats.name
      RATE_LIMIT_DAILY_REQUESTS  = tostring(var.rate_limit_daily_requests)
      RATE_LIMIT_DAILY_TOKENS    = tostring(var.rate_limit_daily_tokens)
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_secrets_access,
    aws_iam_role_policy.lambda_dynamodb_access,
  ]

  tags = {
    Name = "${var.project_name}-judge"
  }
}

# CloudWatch Log Groups for Lambda functions
resource "aws_cloudwatch_log_group" "chat" {
  name              = "/aws/lambda/${aws_lambda_function.chat.function_name}"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-chat-logs"
  }
}

resource "aws_cloudwatch_log_group" "judge" {
  name              = "/aws/lambda/${aws_lambda_function.judge.function_name}"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-judge-logs"
  }
}

# Judge Follow-Up Lambda function
resource "aws_lambda_function" "judge_follow_up" {
  filename         = data.archive_file.lambda_package.output_path
  function_name    = "${var.project_name}-${var.environment}-judge-follow-up"
  role             = aws_iam_role.lambda_execution.arn
  handler          = "judgeFollowUp.handler"
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  runtime          = "nodejs22.x"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory

  environment {
    variables = {
      SECRETS_NAME               = aws_secretsmanager_secret.llm_api_keys.name
      DYNAMODB_TABLE_NAME        = aws_dynamodb_table.chats.name
      RATE_LIMIT_DAILY_REQUESTS  = tostring(var.rate_limit_daily_requests)
      RATE_LIMIT_DAILY_TOKENS    = tostring(var.rate_limit_daily_tokens)
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_secrets_access,
    aws_iam_role_policy.lambda_dynamodb_access,
  ]

  tags = {
    Name = "${var.project_name}-judge-follow-up"
  }
}

resource "aws_cloudwatch_log_group" "judge_follow_up" {
  name              = "/aws/lambda/${aws_lambda_function.judge_follow_up.function_name}"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-judge-follow-up-logs"
  }
}

# Delete Chat Lambda function
resource "aws_lambda_function" "delete_chat" {
  filename         = data.archive_file.lambda_package.output_path
  function_name    = "${var.project_name}-${var.environment}-delete-chat"
  role             = aws_iam_role.lambda_execution.arn
  handler          = "deleteChat.handler"
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.chats.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_dynamodb_access,
  ]

  tags = {
    Name = "${var.project_name}-delete-chat"
  }
}

resource "aws_cloudwatch_log_group" "delete_chat" {
  name              = "/aws/lambda/${aws_lambda_function.delete_chat.function_name}"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-delete-chat-logs"
  }
}

# Create Chat Lambda function
resource "aws_lambda_function" "create_chat" {
  filename         = data.archive_file.lambda_package.output_path
  function_name    = "${var.project_name}-${var.environment}-create-chat"
  role             = aws_iam_role.lambda_execution.arn
  handler          = "createChat.handler"
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.chats.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_dynamodb_access,
  ]

  tags = {
    Name = "${var.project_name}-create-chat"
  }
}

resource "aws_cloudwatch_log_group" "create_chat" {
  name              = "/aws/lambda/${aws_lambda_function.create_chat.function_name}"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-create-chat-logs"
  }
}

# List Chats Lambda function
resource "aws_lambda_function" "list_chats" {
  filename         = data.archive_file.lambda_package.output_path
  function_name    = "${var.project_name}-${var.environment}-list-chats"
  role             = aws_iam_role.lambda_execution.arn
  handler          = "listChats.handler"
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.chats.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_dynamodb_access,
  ]

  tags = {
    Name = "${var.project_name}-list-chats"
  }
}

resource "aws_cloudwatch_log_group" "list_chats" {
  name              = "/aws/lambda/${aws_lambda_function.list_chats.function_name}"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-list-chats-logs"
  }
}
