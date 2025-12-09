#!/bin/bash
# Claude Code Agent Bootstrap Script
#
# This script starts a Claude Code agent that connects to the coordinator
# via NATS MCP tools.
#
# Prerequisites:
# - Claude Code CLI installed (`claude` command available)
# - NATS MCP server configured in Claude's MCP settings
# - NATS server running and accessible
# - Optional: coord CLI for target registration
#
# Environment Variables:
#   NATS_URL                - NATS server URL (required)
#   LOOM_PROJECT_ID        - Project ID for namespace isolation (required)
#   AGENT_HANDLE            - Agent handle/username (default: claude-agent-$HOSTNAME)
#   AGENT_CAPABILITIES      - Comma-separated capabilities (default: general)
#   AGENT_CLASSIFICATIONS   - Comma-separated classifications (default: personal,open-source)
#   IDLE_TIMEOUT_MS         - Idle timeout in ms (default: 300000)
#   WORK_DIR                - Working directory for tasks (default: current dir)
#   TARGET_NAME             - Name of the spin-up target this agent represents (optional)
#   REGISTER_TARGET         - Set to "true" to register target on first run (optional)

set -euo pipefail

# Trap signals for graceful shutdown
trap 'echo "Received shutdown signal, cleaning up..."; exit 0' SIGTERM SIGINT

# Configuration with defaults
NATS_URL="${NATS_URL:?NATS_URL environment variable is required}"
LOOM_PROJECT_ID="${LOOM_PROJECT_ID:?LOOM_PROJECT_ID environment variable is required}"
AGENT_HANDLE="${AGENT_HANDLE:-claude-agent-$(hostname)}"
AGENT_CAPABILITIES="${AGENT_CAPABILITIES:-general}"
AGENT_CLASSIFICATIONS="${AGENT_CLASSIFICATIONS:-personal,open-source}"
IDLE_TIMEOUT_MS="${IDLE_TIMEOUT_MS:-300000}"
WORK_DIR="${WORK_DIR:-$(pwd)}"
TARGET_NAME="${TARGET_NAME:-}"
REGISTER_TARGET="${REGISTER_TARGET:-false}"

echo "=== Claude Code Agent Bootstrap ==="
echo "  NATS URL: $NATS_URL"
echo "  Project ID: $LOOM_PROJECT_ID"
echo "  Handle: $AGENT_HANDLE"
echo "  Capabilities: $AGENT_CAPABILITIES"
echo "  Classifications: $AGENT_CLASSIFICATIONS"
echo "  Idle Timeout: ${IDLE_TIMEOUT_MS}ms"
echo "  Work Directory: $WORK_DIR"
echo "  Target Name: ${TARGET_NAME:-<none>}"
echo "  Register Target: $REGISTER_TARGET"
echo "===================================="

# Change to work directory
cd "$WORK_DIR"

# Optional: Register this machine as a spin-up target
if [[ "$REGISTER_TARGET" == "true" && -n "$TARGET_NAME" ]]; then
  echo ""
  echo "Registering spin-up target: $TARGET_NAME"

  # Check if coord CLI is available
  if command -v coord &> /dev/null; then
    # Register the target (idempotent - won't fail if already exists)
    coord targets add \
      --name "$TARGET_NAME" \
      --type claude-code \
      --mechanism ssh \
      --host "$(hostname -f)" \
      --user "$USER" \
      --command "$(cd "$(dirname "$0")" && pwd)/bootstrap.sh" \
      --capabilities "$AGENT_CAPABILITIES" \
      --classifications "$AGENT_CLASSIFICATIONS" \
      2>/dev/null || echo "  (target may already exist, continuing...)"

    echo "  Target registered successfully"
  else
    echo "  WARNING: coord CLI not found, skipping target registration"
    echo "  Install coord CLI or register manually using register-target.sh"
  fi
  echo ""
fi

# Build the initial prompt for Claude Code
INIT_PROMPT=$(cat <<EOF
You are a worker agent in a coordinated multi-agent system.

Your configuration:
- Handle: $AGENT_HANDLE
- Capabilities: $AGENT_CAPABILITIES
- Classifications: $AGENT_CLASSIFICATIONS
- Project ID: $LOOM_PROJECT_ID
- Target Name: ${TARGET_NAME:-<none>}
- Idle Timeout: ${IDLE_TIMEOUT_MS}ms

On startup, you MUST:
1. Set your handle using: set_handle("$AGENT_HANDLE")
2. Register as an agent using: register_agent({
     agentType: "claude-code",
     capabilities: ["${AGENT_CAPABILITIES//,/\", \"}"],
     allowedClassifications: ["${AGENT_CLASSIFICATIONS//,/\", \"}"],
     hostname: "$(hostname)",
     visibility: "project-only",
     spindownAfterIdleMs: $IDLE_TIMEOUT_MS
   })
3. If TARGET_NAME is set, link yourself to the target using the coordinator API
4. Start listening for work offers

Then continuously:
1. Check for work offers using read_direct_messages()
2. When you receive a work-offer message:
   - Send a work-claim response to the coordinator
   - Execute the task
   - Report progress periodically
   - Send completion or error when done
3. Monitor idle time and gracefully shutdown after ${IDLE_TIMEOUT_MS}ms of inactivity
4. Handle SIGTERM gracefully by completing current work and deregistering

Error handling:
- If registration fails, log the error and retry once after 5 seconds
- If connection to NATS is lost, attempt to reconnect
- On unrecoverable errors, deregister and exit with non-zero status

Start now by registering yourself.
EOF
)

# Start Claude Code with the initialization prompt
# The --dangerously-skip-permissions flag may be needed for automation
# Adjust flags as needed based on your Claude Code version
echo ""
echo "Starting Claude Code agent..."
echo ""

exec claude \
  --project "$WORK_DIR" \
  --prompt "$INIT_PROMPT" \
  --print
