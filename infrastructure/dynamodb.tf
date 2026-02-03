# DynamoDB table for chat history
# Single-table design: stores chat metadata, messages, and user-chat index items
resource "aws_dynamodb_table" "chats" {
  name         = "${var.project_name}-${var.environment}-chats"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  tags = {
    Name        = "${var.project_name}-chats"
    Environment = var.environment
  }
}
