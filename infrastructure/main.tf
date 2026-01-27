terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  # Local backend for now - easy to migrate to S3 later by uncommenting below:
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "chatbot/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "chatbot"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

# Data source for current AWS account
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
