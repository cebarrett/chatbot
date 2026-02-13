# CloudWatch alarms for LLM spend monitoring

# SNS topic for alarm notifications
resource "aws_sns_topic" "alarm_notifications" {
  name = "${var.project_name}-${var.environment}-alarm-notifications"

  tags = {
    Name        = "${var.project_name}-alarm-notifications"
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_notification_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarm_notifications.arn
  protocol  = "email"
  endpoint  = var.alarm_notification_email
}

# High invocation count alarm — chat Lambda
resource "aws_cloudwatch_metric_alarm" "chat_high_invocations" {
  alarm_name          = "${var.project_name}-${var.environment}-chat-high-invocations"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 3600
  statistic           = "Sum"
  threshold           = var.alarm_chat_invocations_per_hour
  alarm_description   = "Chat Lambda invocations exceeded ${var.alarm_chat_invocations_per_hour}/hour"
  alarm_actions       = [aws_sns_topic.alarm_notifications.arn]

  dimensions = {
    FunctionName = aws_lambda_function.chat.function_name
  }

  tags = {
    Name        = "${var.project_name}-chat-high-invocations"
    Environment = var.environment
  }
}

# High invocation count alarm — judge Lambda
resource "aws_cloudwatch_metric_alarm" "judge_high_invocations" {
  alarm_name          = "${var.project_name}-${var.environment}-judge-high-invocations"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 3600
  statistic           = "Sum"
  threshold           = var.alarm_judge_invocations_per_hour
  alarm_description   = "Judge Lambda invocations exceeded ${var.alarm_judge_invocations_per_hour}/hour"
  alarm_actions       = [aws_sns_topic.alarm_notifications.arn]

  dimensions = {
    FunctionName = aws_lambda_function.judge.function_name
  }

  tags = {
    Name        = "${var.project_name}-judge-high-invocations"
    Environment = var.environment
  }
}

# High error rate alarm — chat Lambda
resource "aws_cloudwatch_metric_alarm" "chat_high_errors" {
  alarm_name          = "${var.project_name}-${var.environment}-chat-high-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 3600
  statistic           = "Sum"
  threshold           = 50
  alarm_description   = "Chat Lambda errors exceeded 50/hour"
  alarm_actions       = [aws_sns_topic.alarm_notifications.arn]

  dimensions = {
    FunctionName = aws_lambda_function.chat.function_name
  }

  tags = {
    Name        = "${var.project_name}-chat-high-errors"
    Environment = var.environment
  }
}
