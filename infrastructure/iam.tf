# IAM role for Lambda functions
resource "aws_iam_role" "lambda_execution" {
  name = "${var.project_name}-${var.environment}-lambda-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# Basic Lambda execution policy (CloudWatch Logs)
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Policy for Secrets Manager access
resource "aws_iam_role_policy" "lambda_secrets_access" {
  name = "${var.project_name}-${var.environment}-secrets-access"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = aws_secretsmanager_secret.llm_api_keys.arn
      }
    ]
  })
}

# Policy for AppSync access (to publish subscription events)
resource "aws_iam_role_policy" "lambda_appsync_access" {
  name = "${var.project_name}-${var.environment}-appsync-access"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "appsync:GraphQL"
        ]
        Resource = "${aws_appsync_graphql_api.chatbot.arn}/*"
      }
    ]
  })
}

# IAM role for AppSync to invoke Lambda
resource "aws_iam_role" "appsync_lambda" {
  name = "${var.project_name}-${var.environment}-appsync-lambda"

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

# Policy for AppSync to invoke Lambda functions
resource "aws_iam_role_policy" "appsync_lambda_invoke" {
  name = "${var.project_name}-${var.environment}-appsync-lambda-invoke"
  role = aws_iam_role.appsync_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          aws_lambda_function.chat.arn,
          aws_lambda_function.judge.arn,
          aws_lambda_function.delete_chat.arn,
          aws_lambda_function.create_chat.arn,
          aws_lambda_function.list_chats.arn
        ]
      }
    ]
  })
}

# IAM role for AppSync DynamoDB data source
resource "aws_iam_role" "appsync_dynamodb" {
  name = "${var.project_name}-${var.environment}-appsync-dynamodb"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "appsync.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "appsync_dynamodb_access" {
  name = "${var.project_name}-${var.environment}-appsync-dynamodb-access"
  role = aws_iam_role.appsync_dynamodb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem"
      ]
      Resource = [
        aws_dynamodb_table.chats.arn
      ]
    }]
  })
}

# Policy for Lambda DynamoDB access (used by deleteChat, chat, judge, createChat, listChats)
resource "aws_iam_role_policy" "lambda_dynamodb_access" {
  name = "${var.project_name}-${var.environment}-lambda-dynamodb-access"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem"
      ]
      Resource = [
        aws_dynamodb_table.chats.arn
      ]
    }]
  })
}
