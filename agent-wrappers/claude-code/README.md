# Claude Code Agent Bootstrap

This directory contains scripts for bootstrapping Claude Code as a worker agent in the coordinator system.

## Prerequisites

1. **Claude Code CLI** installed and authenticated
2. **NATS MCP Server** configured in Claude's MCP settings:
   ```json
   {
     "mcpServers": {
       "nats-mcp": {
         "command": "warp",
         "env": {
           "NATS_URL": "nats://your-server:4222"
         }
       }
     }
   }
   ```
3. **Shuttle CLI** (optional, for target registration)

## Scripts

- **bootstrap.sh** - Starts a Claude Code agent and optionally registers its spin-up target
- **register-target.sh** - Registers this machine as a spin-up target (run once per machine)

## Quick Start

### Option 1: Register Target First (Recommended)

This approach registers your machine as a target first, then the coordinator can spin up agents as needed:

```bash
# 1. Register this machine as a target
./register-target.sh

# 2. The coordinator will automatically spin up agents when work arrives
# No need to manually run bootstrap.sh
```

### Option 2: Manual Agent Start

Start an agent directly without registering as a target:

```bash
NATS_URL=nats://localhost:4222 \
LOOM_PROJECT_ID=my-project \
./bootstrap.sh
```

### Option 3: Self-Registering Agent

Start an agent that registers its own spin-up target on first run:

```bash
NATS_URL=nats://localhost:4222 \
LOOM_PROJECT_ID=my-project \
TARGET_NAME=home-claude \
REGISTER_TARGET=true \
./bootstrap.sh
```

## Environment Variables

### bootstrap.sh

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NATS_URL` | Yes | - | NATS server URL |
| `LOOM_PROJECT_ID` | Yes | - | Project ID for isolation |
| `AGENT_HANDLE` | No | `claude-agent-$HOSTNAME` | Agent identifier |
| `AGENT_CAPABILITIES` | No | `general` | Comma-separated capabilities |
| `AGENT_CLASSIFICATIONS` | No | `personal,open-source` | Comma-separated classifications |
| `IDLE_TIMEOUT_MS` | No | `300000` | Idle timeout (5 min, 0=never) |
| `WORK_DIR` | No | Current directory | Working directory |
| `TARGET_NAME` | No | - | Name of spin-up target this agent represents |
| `REGISTER_TARGET` | No | `false` | Set to "true" to register target on startup |

### register-target.sh

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TARGET_NAME` | No | `$HOSTNAME-claude` | Unique target name |
| `AGENT_CAPABILITIES` | No | `general` | Comma-separated capabilities |
| `AGENT_CLASSIFICATIONS` | No | `personal,open-source` | Comma-separated classifications |
| `TARGET_DESCRIPTION` | No | Auto-generated | Human-readable description |
| `SSH_HOST` | No | `$(hostname -f)` | SSH hostname |
| `SSH_USER` | No | `$USER` | SSH username |
| `BOOTSTRAP_PATH` | No | Auto-detected | Path to bootstrap.sh |

## Usage Examples

### Example 1: Development Machine

Register your development machine for personal projects:

```bash
# Register the target
TARGET_NAME=dev-laptop-claude \
AGENT_CAPABILITIES=typescript,python,docker \
AGENT_CLASSIFICATIONS=personal,open-source \
./register-target.sh

# The coordinator will spin up agents automatically when needed
```

### Example 2: Specialized Server

Register a server with specific capabilities:

```bash
# Register a server for Kubernetes work
TARGET_NAME=k8s-server-claude \
AGENT_CAPABILITIES=kubernetes,helm,yaml \
AGENT_CLASSIFICATIONS=personal \
SSH_HOST=k8s-server.local \
./register-target.sh
```

### Example 3: Multi-Capability Agent

Start an agent with multiple capabilities:

```bash
NATS_URL=nats://nats.example.com:4222 \
LOOM_PROJECT_ID=my-org \
AGENT_CAPABILITIES=typescript,python,kubernetes,docker \
AGENT_CLASSIFICATIONS=personal,open-source,corporate-adjacent \
./bootstrap.sh
```

### Example 4: Long-Running Agent

Start an agent that never times out:

```bash
NATS_URL=nats://localhost:4222 \
LOOM_PROJECT_ID=my-project \
IDLE_TIMEOUT_MS=0 \
./bootstrap.sh
```

## Remote Spin-Up via SSH

Once a target is registered, the coordinator can spin up agents remotely:

```bash
# Manual spin-up via Shuttle CLI
coord spin-up --target dev-laptop-claude

# Automatic spin-up when work arrives
coord submit "Fix the TypeScript build errors" \
  --classification personal \
  --capability typescript
# If no agents are available, coordinator will:
# 1. Find a target with typescript capability and personal classification
# 2. SSH to that machine and run bootstrap.sh
# 3. Wait for agent to register and claim the work
```

## Target Registration Details

### What Gets Registered

When you register a target, the coordinator stores:
- Target name (unique identifier)
- Agent type (claude-code)
- Spin-up mechanism (SSH)
- SSH connection details (host, user, command)
- Capabilities (what the agent can do)
- Allowed classifications (what work it can accept)
- Health check configuration

### Target Lifecycle

1. **Registration**: Target is added to the coordinator's registry
2. **Discovery**: Coordinator queries targets when work arrives
3. **Health Checks**: Periodic SSH connectivity tests (if enabled)
4. **Spin-Up**: When matched to work, coordinator SSHs and runs bootstrap.sh
5. **Agent Link**: Running agent links to its target
6. **Cleanup**: When agent shuts down, target becomes available again

### Managing Targets

```bash
# List all targets
coord targets list

# Show target details
coord targets show dev-laptop-claude

# Update target capabilities
coord targets update dev-laptop-claude --capabilities typescript,python,go

# Disable a target temporarily
coord targets disable dev-laptop-claude

# Re-enable a target
coord targets enable dev-laptop-claude

# Remove a target
coord targets remove dev-laptop-claude

# Test target connectivity
coord targets test dev-laptop-claude
```

## How It Works

1. **Initialization**: The script sets environment variables and changes to the work directory
2. **Target Registration** (optional): If REGISTER_TARGET=true, registers itself as a spin-up target
3. **Claude Code Start**: Starts Claude Code with an initialization prompt
4. **Agent Registration**: Claude uses MCP tools to register with the coordinator
5. **Target Linking** (optional): If TARGET_NAME is set, links agent to its target
6. **Work Loop**: Claude listens for work offers, claims tasks, and reports results
7. **Idle Detection**: Monitors activity and shuts down after idle timeout
8. **Shutdown**: On idle timeout or SIGTERM, Claude deregisters and exits gracefully

## Troubleshooting

### Agent Won't Register

1. Check NATS MCP server is configured correctly in `~/.claude/mcp.json`
2. Verify NATS_URL is accessible from this machine
3. Check LOOM_PROJECT_ID matches the coordinator's project ID
4. Look for error messages in Claude's output

### Target Registration Fails

1. Ensure Shuttle CLI is installed: `npm install -g @loom/shuttle`
2. Verify Shuttle CLI can connect to coordinator
3. Check SSH connectivity: `ssh $SSH_USER@$SSH_HOST 'echo OK'`
4. Verify bootstrap.sh path is correct and accessible

### Agent Not Receiving Work

1. Check agent capabilities match work requirements
2. Verify agent classifications allow the work classification
3. Confirm agent status is "online": `coord agents`
4. Check work queue: `coord work`

### SSH Spin-Up Fails

1. Test SSH connectivity manually: `ssh user@host 'echo OK'`
2. Verify SSH key-based authentication is configured
3. Check bootstrap.sh has execute permissions
4. Ensure NATS_URL and other env vars are set correctly in bootstrap.sh

## Customization

### Custom Agents

You can create custom agent prompts by modifying the `INIT_PROMPT` in the script or by placing an `AGENTS.md` file in the work directory.

### MCP Configuration

Ensure the NATS MCP server is properly configured in `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "nats-mcp": {
      "command": "warp",
      "env": {
        "NATS_URL": "${NATS_URL}",
        "NATS_PROJECT_ID": "${LOOM_PROJECT_ID}"
      }
    }
  }
}
```

### Custom Spin-Up Mechanisms

While this implementation uses SSH, you can adapt the scripts for other mechanisms:
- **Local**: Run bootstrap.sh as a local process
- **Kubernetes**: Deploy as a Job or Pod
- **GitHub Actions**: Trigger a workflow that runs bootstrap.sh
- **Webhook**: Call an endpoint that starts the agent
