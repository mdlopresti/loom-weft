#!/bin/bash
# Register Target Script for Claude Code
#
# This script registers this machine as a spin-up target in the coordinator
# system. Run this once per machine to enable remote agent spin-up.
#
# Prerequisites:
# - coord CLI installed and configured
# - SSH access configured (for SSH-based spin-up)
#
# Environment Variables:
#   NATS_URL                - NATS server URL (optional, for coord CLI config)
#   LOOM_PROJECT_ID        - Project ID (optional, for coord CLI config)
#   TARGET_NAME             - Target name (default: hostname-claude)
#   AGENT_CAPABILITIES      - Comma-separated capabilities (default: general)
#   AGENT_CLASSIFICATIONS   - Comma-separated classifications (default: personal,open-source)
#   TARGET_DESCRIPTION      - Description of this target (optional)
#   SSH_HOST                - SSH hostname (default: hostname -f)
#   SSH_USER                - SSH username (default: $USER)
#   BOOTSTRAP_PATH          - Path to bootstrap.sh (default: auto-detected)

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration with defaults
TARGET_NAME="${TARGET_NAME:-$(hostname)-claude}"
AGENT_CAPABILITIES="${AGENT_CAPABILITIES:-general}"
AGENT_CLASSIFICATIONS="${AGENT_CLASSIFICATIONS:-personal,open-source}"
TARGET_DESCRIPTION="${TARGET_DESCRIPTION:-Claude Code agent on $(hostname)}"
SSH_HOST="${SSH_HOST:-$(hostname -f)}"
SSH_USER="${SSH_USER:-$USER}"
BOOTSTRAP_PATH="${BOOTSTRAP_PATH:-$SCRIPT_DIR/bootstrap.sh}"

echo "=== Registering Claude Code Target ==="
echo "  Target Name: $TARGET_NAME"
echo "  Capabilities: $AGENT_CAPABILITIES"
echo "  Classifications: $AGENT_CLASSIFICATIONS"
echo "  SSH Host: $SSH_HOST"
echo "  SSH User: $SSH_USER"
echo "  Bootstrap Script: $BOOTSTRAP_PATH"
echo "======================================"

# Verify bootstrap script exists
if [[ ! -f "$BOOTSTRAP_PATH" ]]; then
  echo "ERROR: Bootstrap script not found at: $BOOTSTRAP_PATH"
  echo "Please set BOOTSTRAP_PATH to the correct location"
  exit 1
fi

# Verify coord CLI is available
if ! command -v coord &> /dev/null; then
  echo "ERROR: coord CLI not found in PATH"
  echo ""
  echo "Please install the coord CLI tool:"
  echo "  cd coordinator-system/coord-cli"
  echo "  npm install -g ."
  echo ""
  exit 1
fi

# Build the registration command
echo ""
echo "Registering target with coordinator..."

# Use coord CLI to register the target
coord targets add \
  --name "$TARGET_NAME" \
  --type claude-code \
  --mechanism ssh \
  --host "$SSH_HOST" \
  --user "$SSH_USER" \
  --command "$BOOTSTRAP_PATH" \
  --capabilities "$AGENT_CAPABILITIES" \
  --classifications "$AGENT_CLASSIFICATIONS" \
  --description "$TARGET_DESCRIPTION"

if [[ $? -eq 0 ]]; then
  echo ""
  echo "SUCCESS: Target registered successfully!"
  echo ""
  echo "The coordinator can now spin up Claude Code agents on this machine via:"
  echo "  coord spin-up --target $TARGET_NAME"
  echo ""
  echo "Or automatically when work matching these criteria arrives:"
  echo "  Capabilities: $AGENT_CAPABILITIES"
  echo "  Classifications: $AGENT_CLASSIFICATIONS"
  echo ""
  echo "To test SSH connectivity:"
  echo "  ssh $SSH_USER@$SSH_HOST '$BOOTSTRAP_PATH'"
  echo ""
else
  echo ""
  echo "ERROR: Failed to register target"
  echo "Check the error messages above for details"
  exit 1
fi
