# S3 bucket for storing generated images
resource "aws_s3_bucket" "generated_images" {
  bucket = "${var.project_name}-${var.environment}-generated-images"
}

resource "aws_s3_bucket_public_access_block" "generated_images" {
  bucket = aws_s3_bucket.generated_images.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "generated_images" {
  bucket = aws_s3_bucket.generated_images.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "images_lifecycle" {
  bucket = aws_s3_bucket.generated_images.id

  rule {
    id     = "expire-standard-images"
    status = "Enabled"
    filter {
      prefix = "images/"
    }
    expiration {
      days = 90
    }
  }

  rule {
    id     = "expire-ephemeral-images"
    status = "Enabled"
    filter {
      prefix = "ephemeral/"
    }
    expiration {
      days = 1 # Safety net — per-object Expires handles the fast path
    }
  }
}
