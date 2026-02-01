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
    command     = "npm ci && npm run build && cp -r node_modules dist/"
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
  runtime          = "nodejs20.x"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory

  environment {
    variables = {
      SECRETS_NAME = aws_secretsmanager_secret.llm_api_keys.name
      APPSYNC_URL  = aws_appsync_graphql_api.chatbot.uris["GRAPHQL"]
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_secrets_access,
    aws_iam_role_policy.lambda_appsync_access,
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
  runtime          = "nodejs20.x"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory

  environment {
    variables = {
      SECRETS_NAME = aws_secretsmanager_secret.llm_api_keys.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_secrets_access,
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
