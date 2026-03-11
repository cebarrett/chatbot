#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# --- Install AWS CLI v2 ---
if ! command -v aws &> /dev/null; then
  echo "Installing AWS CLI v2..."
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -qo /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/awscliv2.zip /tmp/aws
  echo "AWS CLI installed: $(aws --version)"
fi

# --- Install Terraform ---
if ! command -v terraform &> /dev/null; then
  echo "Installing Terraform..."
  curl -fsSL https://releases.hashicorp.com/terraform/1.12.1/terraform_1.12.1_linux_amd64.zip -o /tmp/terraform.zip
  unzip -qo /tmp/terraform.zip -d /usr/local/bin
  rm -f /tmp/terraform.zip
  echo "Terraform installed: $(terraform version -json | head -1)"
fi

# --- Install frontend npm dependencies ---
echo "Installing frontend dependencies..."
cd "$PROJECT_DIR"
npm install

# --- Install Lambda npm dependencies ---
echo "Installing Lambda dependencies..."
cd "$PROJECT_DIR/infrastructure/lambda"
npm install

echo "Session start hook complete."
