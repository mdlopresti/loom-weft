# Copilot Bridge - NATS to GitHub Copilot CLI

A bridge service that connects the coordinator system to GitHub Copilot CLI, enabling automated task execution through Copilot.

## Overview

The Copilot Bridge acts as a worker agent in the coordinator system. It:
- Connects to NATS and subscribes to work queues
- Processes work items by invoking `copilot` CLI
- Reports completion and errors back to the coordinator
- Optionally registers itself as a spin-up target
- Links to its target when running as a spun-up agent
- Shuts down gracefully after idle timeout

## Prerequisites

1. **GitHub Copilot CLI** installed and authenticated
   ```bash
   npm install -g @githubnext/github-copilot-cli
   copilot auth login
   ```

2. **NATS Server** running and accessible

3. **Node.js** 18+ (for running the bridge)

## Installation

### Local Installation

```bash
cd coordinator-system/agent-wrappers/copilot-bridge
npm install
npm run build
```

### Global Installation

```bash
cd coordinator-system/agent-wrappers/copilot-bridge
npm install -g .
```

After global installation, you can run `copilot-bridge` from anywhere.

## Configuration

The bridge can be configured via environment variables, config file, or both (env vars take precedence).

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NATS_URL` | Yes | - | NATS server URL |
| `LOOM_PROJECT_ID` | Yes | - | Project ID for isolation |
| `AGENT_HANDLE` | No | `copilot-agent-$HOSTNAME` | Agent identifier |
| `AGENT_CAPABILITIES` | No | `general` | Comma-separated capabilities |
| `AGENT_BOUNDARIES` | No | `default` | Comma-separated workload boundaries |
| `IDLE_TIMEOUT_MS` | No | `300000` | Idle timeout (5 min, 0=never) |
| `TARGET_NAME` | No | - | Name of spin-up target this agent represents |
| `REGISTER_TARGET` | No | `false` | Set to "true" to register target on startup |
| `MAX_CONCURRENT` | No | `1` | Max concurrent work items |
| `COPILOT_PATH` | No | `copilot` | Path to copilot CLI |
| `WORK_DIR` | No | Current directory | Working directory for copilot |
| `COPILOT_AGENT` | No | - | Specific Copilot agent to use |
| `COPILOT_ENV_*` | No | - | Additional env vars for copilot (prefix with `COPILOT_ENV_`) |

### Config File

Create a config file at one of these locations:
- `./copilot-bridge.json` (current directory)
- `~/.config/copilot-bridge/config.json` (home directory)
- Path specified via `COPILOT_BRIDGE_CONFIG` env var

Example `copilot-bridge.json`:
```json
{
  "natsUrl": "nats://localhost:4222",
  "projectId": "my-project",
  "agentHandle": "work-copilot",
  "capabilities": ["typescript", "python", "general"],
  "boundaries": ["production", "staging"],
  "idleTimeoutMs": 600000,
  "targetName": "work-laptop-copilot",
  "registerTarget": false,
  "maxConcurrent": 2,
  "copilotPath": "copilot",
  "workingDirectory": "/home/user/projects",
  "copilotAgent": "gpt-4"
}
```

## Usage

### Quick Start

Start the bridge with minimal configuration:

```bash
NATS_URL=nats://localhost:4222 \
LOOM_PROJECT_ID=my-project \
copilot-bridge
```

### With Target Registration

Start a bridge that registers itself as a spin-up target:

```bash
NATS_URL=nats://localhost:4222 \
LOOM_PROJECT_ID=my-project \
TARGET_NAME=work-copilot \
REGISTER_TARGET=true \
AGENT_CAPABILITIES=typescript,python,kubernetes \
copilot-bridge
```

### Corporate Environment

Start a bridge for corporate work with specific capabilities:

```bash
NATS_URL=nats://nats.corp.example.com:4222 \
LOOM_PROJECT_ID=engineering \
AGENT_HANDLE=corp-copilot-01 \
AGENT_CAPABILITIES=typescript,react,azure \
AGENT_BOUNDARIES=production,staging \
COPILOT_AGENT=gpt-4 \
copilot-bridge
```

### Long-Running Service

Start a bridge that never times out:

```bash
NATS_URL=nats://localhost:4222 \
LOOM_PROJECT_ID=my-project \
IDLE_TIMEOUT_MS=0 \
copilot-bridge
```

### With Config File

```bash
# Use config from file
copilot-bridge /path/to/config.json

# Or use default location
copilot-bridge
```

## Target Self-Registration

The bridge can register itself as a spin-up target on startup. This allows the coordinator to automatically spin up new instances when needed.

### How It Works

1. **On First Run**: Set `REGISTER_TARGET=true` and `TARGET_NAME`
2. **Target Registration**: Bridge registers itself with coordinator
3. **Target Storage**: Configuration stored in NATS KV bucket
4. **Future Spin-Ups**: Coordinator can launch new instances using the stored config

### Example Workflow

```bash
# First run - register the target
NATS_URL=nats://localhost:4222 \
LOOM_PROJECT_ID=my-project \
TARGET_NAME=dev-copilot \
REGISTER_TARGET=true \
AGENT_CAPABILITIES=typescript,python \
AGENT_BOUNDARIES=staging,development \
copilot-bridge

# Bridge starts and registers itself
# Then the coordinator can spin up new instances:
coord spin-up --target dev-copilot

# Or automatically when work arrives:
coord submit "Fix the build error" \
  --boundary staging \
  --capability typescript
```

### Target Linking

When a bridge is spun up by the coordinator:

1. Coordinator selects a target and starts the bridge
2. Bridge starts with `TARGET_NAME` set
3. Bridge links itself to the target (marks target as "in-use")
4. When bridge shuts down, target becomes available again

## Work Processing

### How Work Items Are Processed

1. **Work Arrives**: Coordinator publishes work to capability queue
2. **Bridge Claims**: Bridge receives work if boundary matches
3. **Execute Copilot**: Bridge runs `copilot --prompt "..." --allow-all-tools`
4. **Capture Output**: stdout/stderr captured
5. **Report Result**: Completion or error sent back to coordinator

### Copilot Command Construction

The bridge builds copilot commands like this:

```bash
copilot \
  --prompt "Task description with context" \
  --allow-all-tools \
  --agent gpt-4  # If specified in config or work item
```

Context data from work items is appended to the prompt:

```bash
copilot --prompt "Fix the build error

Context:
{
  \"repository\": \"myorg/myapp\",
  \"branch\": \"feature-xyz\",
  \"error\": \"TypeScript compilation failed\"
}" \
--allow-all-tools
```

## Idle Timeout and Shutdown

### Idle Detection

- Bridge tracks last activity time
- Checks every 10 seconds if idle timeout exceeded
- Only shuts down if no work is in progress

### Graceful Shutdown

When shutting down (idle, SIGTERM, or SIGINT):

1. Stop accepting new work
2. Wait for current work to complete
3. Unlink from target (if linked)
4. Update agent status to offline
5. Deregister from coordinator
6. Close NATS connection
7. Exit cleanly

## Monitoring

### Checking Bridge Status

```bash
# List all agents (including copilot bridges)
coord agents

# Show specific agent
coord agents --type copilot-cli

# Show work queue
coord work
```

### Logs

The bridge outputs structured logs to stdout:

```
=== Copilot Bridge Configuration ===
  NATS URL: nats://localhost:4222
  Project ID: my-project
  ...
====================================

=== Starting Copilot Bridge ===
Connecting to NATS...
  Connected to NATS
Registering as agent...
  Registered with GUID: abc-123-def
...
=== Copilot Bridge Ready ===
Waiting for work...

=== Processing Work Item ===
  ID: work-456
  Boundary: staging
  Description: Fix the TypeScript build
============================

Executing: copilot --prompt "Fix the TypeScript build" --allow-all-tools
[Copilot output appears here]

Work work-456 completed successfully
```

## Deployment

### Systemd Service

Create `/etc/systemd/system/copilot-bridge.service`:

```ini
[Unit]
Description=Copilot Bridge for NATS Coordinator
After=network.target

[Service]
Type=simple
User=copilot
WorkingDirectory=/home/copilot
Environment=NATS_URL=nats://localhost:4222
Environment=LOOM_PROJECT_ID=production
Environment=AGENT_HANDLE=prod-copilot
Environment=AGENT_CAPABILITIES=typescript,python,kubernetes
Environment=AGENT_BOUNDARIES=production,staging
Environment=IDLE_TIMEOUT_MS=600000
ExecStart=/usr/local/bin/copilot-bridge
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable copilot-bridge
sudo systemctl start copilot-bridge
sudo systemctl status copilot-bridge
```

### Docker

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

# Install copilot CLI
RUN npm install -g @githubnext/github-copilot-cli

# Copy bridge code
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY dist ./dist

# Run bridge
CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t copilot-bridge .

docker run -e NATS_URL=nats://host.docker.internal:4222 \
           -e LOOM_PROJECT_ID=my-project \
           -e AGENT_CAPABILITIES=typescript,python \
           copilot-bridge
```

### Kubernetes

Create `deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: copilot-bridge
spec:
  replicas: 2
  selector:
    matchLabels:
      app: copilot-bridge
  template:
    metadata:
      labels:
        app: copilot-bridge
    spec:
      containers:
      - name: bridge
        image: copilot-bridge:latest
        env:
        - name: NATS_URL
          value: nats://nats.default.svc:4222
        - name: LOOM_PROJECT_ID
          value: production
        - name: AGENT_CAPABILITIES
          value: typescript,python,kubernetes
        - name: AGENT_BOUNDARIES
          value: production,staging
        - name: IDLE_TIMEOUT_MS
          value: "0"  # Never timeout in k8s
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
```

## Troubleshooting

### Bridge Won't Start

1. Check NATS_URL is correct and NATS is running
2. Verify LOOM_PROJECT_ID matches coordinator
3. Test copilot CLI works: `copilot --version`
4. Check authentication: `copilot auth status`

### No Work Received

1. Verify capabilities match work requirements
2. Check boundaries allow the work type
3. Confirm bridge is registered: `coord agents`
4. Check work queue: `coord work`

### Copilot Execution Fails

1. Test copilot manually: `copilot --prompt "test" --allow-all-tools`
2. Check working directory exists and is accessible
3. Verify environment variables are set correctly
4. Check copilot logs for authentication issues

### Target Registration Fails

1. Ensure TARGET_NAME is unique
2. Verify NATS connection is stable
3. Check coordinator is running
4. Look for error messages in bridge output

## Advanced Configuration

### Multiple Concurrent Work Items

Process up to 3 work items concurrently:

```bash
MAX_CONCURRENT=3 copilot-bridge
```

### Custom Copilot Agent

Use a specific Copilot model:

```bash
COPILOT_AGENT=gpt-4 copilot-bridge
```

Or specify per work item via context data:

```bash
coord submit "Complex refactoring task" \
  --capability typescript \
  --boundary production \
  --context '{"agent": "gpt-4"}'
```

### Additional Environment Variables

Pass extra environment variables to copilot:

```bash
COPILOT_ENV_DEBUG=1 \
COPILOT_ENV_CUSTOM_VAR=value \
copilot-bridge
```

These become `DEBUG=1` and `CUSTOM_VAR=value` when copilot runs.

### Working Directory

Set a specific working directory for copilot execution:

```bash
WORK_DIR=/home/user/projects copilot-bridge
```

## Development

### Running from Source

```bash
cd coordinator-system/agent-wrappers/copilot-bridge
npm install
npm run dev
```

### Building

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

### Testing

```bash
npm test
```

## Architecture

### Components

- **config.ts**: Configuration loading and validation
- **target-registration.ts**: Self-registration as spin-up target
- **bridge.ts**: Main bridge logic (NATS connection, work processing)
- **index.ts**: Entry point and CLI

### Work Flow

```
┌─────────────────┐
│   Coordinator   │
│                 │
│  Publishes work │
│   to queues     │
└────────┬────────┘
         │
         │ NATS
         │
         ▼
┌─────────────────┐
│ Copilot Bridge  │
│                 │
│  Subscribes to  │
│   work queues   │
└────────┬────────┘
         │
         │ Invokes
         │
         ▼
┌─────────────────┐
│  Copilot CLI    │
│                 │
│  Executes task  │
│  Returns result │
└────────┬────────┘
         │
         │ Reports
         │
         ▼
┌─────────────────┐
│   Coordinator   │
│                 │
│  Updates status │
│  Stores result  │
└─────────────────┘
```

## License

Part of the coordinator system project.
