#!/bin/bash

# S3 Deployment Script for Vite React App
# Prerequisites: AWS CLI configured with appropriate credentials

set -e

# Configuration - set these environment variables or modify defaults
S3_BUCKET="${S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if S3 bucket is configured
if [ -z "$S3_BUCKET" ]; then
    echo -e "${RED}Error: S3_BUCKET environment variable is not set${NC}"
    echo "Usage: S3_BUCKET=your-bucket-name ./scripts/deploy.sh"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    echo "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

echo -e "${YELLOW}Building project...${NC}"
npm run build

echo -e "${YELLOW}Deploying to S3 bucket: ${S3_BUCKET}${NC}"

# Sync dist folder to S3
aws s3 sync dist/ "s3://${S3_BUCKET}" \
    --region "${AWS_REGION}" \
    --delete \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "index.html" \
    --exclude "*.json"

# Upload index.html and JSON files with no-cache
aws s3 cp dist/index.html "s3://${S3_BUCKET}/index.html" \
    --region "${AWS_REGION}" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "text/html"

# Upload any JSON files (like manifest) with short cache
if ls dist/*.json 1> /dev/null 2>&1; then
    for file in dist/*.json; do
        filename=$(basename "$file")
        aws s3 cp "$file" "s3://${S3_BUCKET}/${filename}" \
            --region "${AWS_REGION}" \
            --cache-control "public, max-age=0, must-revalidate" \
            --content-type "application/json"
    done
fi

echo -e "${GREEN}Successfully deployed to S3!${NC}"

# Invalidate CloudFront cache if distribution ID is provided
if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
    echo -e "${YELLOW}Invalidating CloudFront cache...${NC}"
    aws cloudfront create-invalidation \
        --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
        --paths "/*" \
        --region "${AWS_REGION}"
    echo -e "${GREEN}CloudFront invalidation created!${NC}"
fi

echo -e "${GREEN}Deployment complete!${NC}"
echo -e "Your app is available at: http://${S3_BUCKET}.s3-website-${AWS_REGION}.amazonaws.com"
