# Weft

**Intelligent coordination for Loom.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Beta](https://img.shields.io/badge/Status-Beta-blue.svg)](https://github.com/mdlopresti/loom-weft/releases)

This package contains the orchestration layer for [Loom](../README.md) — the coordinator service that weaves work through your agent fabric.

> **Note**: The Shuttle CLI has been moved to its own repository: **[loom-shuttle](https://github.com/mdlopresti/loom-shuttle)**

> **🔷 Beta Software**: This project has passed integration testing and is suitable for early adopters. While core functionality is stable, some features may still change. Feedback and contributions are welcome!

> **Weft** (noun): In weaving, the weft threads are the horizontal threads that weave through the warp, creating the pattern.

## Overview

| Component | Purpose | Repository |
|-----------|---------|------------|
| **Weft** | Coordinator service — routes work, manages agent lifecycle, handles scaling | This repo |
| **Shuttle** | CLI tool — submit work, manage agents, monitor your fleet | [loom-shuttle](https://github.com/mdlopresti/loom-shuttle) |

Together they enable:
- **Work routing** based on data classification (corporate vs personal)
- **Dynamic agent spin-up** when work arrives and no agents are available
- **Automatic scale-down** of idle agents
- **Fleet management** from the command line

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      WEFT (Coordinator)                      │
│                  (Always Running - Central Hub)              │
├─────────────────────────────────────────────────────────────┤
│  • Routes work based on classification                       │
│  • Manages dynamic target registry                           │
│  • Triggers agent spin-up via SSH/K8s/GitHub Actions        │
│  • Monitors idle agents and triggers scale-down              │
│  • Exposes REST API for integration                          │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
   ┌──────────┐         ┌──────────┐         ┌──────────┐
   │   WARP   │         │  Target  │         │   REST   │
   │ (NATS)   │         │ Registry │         │   API    │
   └──────────┘         └──────────┘         └──────────┘
          ▲                                        │
          │                                        │
   ┌──────┴──────────────────────────────────────┴──────┐
   │                                                     │
   ▼                    ▼                    ▼           ▼
┌────────┐        ┌────────┐          ┌──────────┐  ┌─────────┐
│ Claude │        │ Claude │          │ Copilot  │  │ SHUTTLE │
│ Code   │        │ Code   │          │ CLI      │  │  (CLI)  │
│(Home)  │        │(Cloud) │          │ (Work)   │  │         │
└────────┘        └────────┘          └──────────┘  └─────────┘
```

## Work Classification

| Classification | Description | Routed To |
|----------------|-------------|-----------|
| `corporate` | Requires access to corporate systems/data | Copilot CLI only |
| `corporate-adjacent` | Work-related but no sensitive data | Copilot preferred |
| `personal` | Personal projects | Claude Code preferred |
| `open-source` | Public repositories | Any agent |

## Quick Start

### 1. Start NATS and Weft

**Option A: Docker Compose (easiest)**

```bash
cd weft
docker-compose up -d
```

**Option B: Pull from GitHub Container Registry**

```bash
# Start NATS
docker run -d --name nats -p 4222:4222 nats:latest -js

# Start Weft (Multi-Tenant)
# Note: LOOM_PROJECT_ID is now optional - Weft auto-discovers projects
docker run -d --name weft \
  -p 3000:3000 \
  -e NATS_URL=nats://host.docker.internal:4222 \
  ghcr.io/mdlopresti/loom-weft:latest
```

## Multi-Tenant Architecture

Weft now supports multiple projects in a single deployment. Projects are auto-discovered when agents or clients first connect.

### How It Works

- Single Weft instance handles all projects via NATS wildcard subscriptions (`coord.*.*`)
- Each project gets isolated: coordinator, target registry, idle tracker
- Global stats endpoint shows aggregate metrics across all projects

### Shuttle Multi-Project Usage

```bash
# List all active projects
shuttle projects

# Operate on a specific project (overrides config)
shuttle --project my-app agents
shuttle --project other-app work list
shuttle -p my-app stats

# Configure default project
shuttle config set projectId my-default-project
```

### 2. Install Shuttle

Shuttle is now in its own repository. See **[loom-shuttle](https://github.com/mdlopresti/loom-shuttle)** for installation instructions.

```bash
npm install -g @loom/shuttle
```

### 3. Configure Shuttle

```bash
shuttle config set nats-url nats://localhost:4222
shuttle config set project-id my-project
```

### 4. Register a Spin-Up Target

```bash
# Register your home server as a Claude Code agent target
shuttle targets add \
  --name home-claude \
  --type claude-code \
  --mechanism ssh \
  --host home.example.com \
  --user mike \
  --command "/path/to/bootstrap.sh" \
  --capabilities typescript,python \
  --classifications personal,open-source
```

### 5. Submit Work

```bash
# Submit work (will spin up an agent if needed)
shuttle submit "Refactor the authentication module" \
  --classification personal \
  --capability typescript \
  --priority 7
```

### 6. Monitor

```bash
# Watch work progress
shuttle watch <work-id>

# List agents
shuttle agents list

# List targets
shuttle targets list

# View stats
shuttle stats
```

## Shuttle Commands

For full Shuttle CLI documentation, see **[loom-shuttle](https://github.com/mdlopresti/loom-shuttle)**.

| Command | Description |
|---------|-------------|
| `shuttle submit <task>` | Submit work to the coordinator |
| `shuttle agents list` | List registered agents |
| `shuttle work list` | List work items |
| `shuttle watch <id>` | Watch work progress in real-time |
| `shuttle targets list` | List spin-up targets |
| `shuttle stats` | View coordinator statistics |
| `shuttle config` | Manage CLI configuration |
| `shuttle channels list` | List available channels |
| `shuttle channels read <channel>` | Read messages from a channel |

## Spin-Up Mechanisms

Weft supports multiple ways to spin up agents:

| Mechanism | Use Case |
|-----------|----------|
| **SSH** | Spin up agents on remote servers via SSH |
| **Local** | Spawn local processes |
| **Kubernetes** | Create K8s Jobs for containerized agents |
| **GitHub Actions** | Trigger workflow dispatches |
| **Webhook** | Call custom endpoints |

### SSH Example

```bash
shuttle targets add \
  --name home-server \
  --type claude-code \
  --mechanism ssh \
  --host 192.168.1.100 \
  --user developer \
  --key ~/.ssh/id_rsa \
  --command "~/start-agent.sh"
```

### Kubernetes Example

```bash
shuttle targets add \
  --name k8s-agent \
  --type claude-code \
  --mechanism kubernetes \
  --namespace agents \
  --image ghcr.io/myorg/claude-agent:latest \
  --service-account agent-sa
```

## Packages

| Package | Description |
|---------|-------------|
| `@loom/shared` | Shared types and NATS utilities |
| `@loom/weft` | Coordinator service |
| `@loom/shuttle` | Command-line interface |

## Agent Wrappers

Both Claude Code and GitHub Copilot CLI connect to Loom via Warp (MCP server). Bootstrap scripts handle agent registration and work queue subscription.

### Claude Code

Use the bootstrap script to start a Claude Code agent:

```bash
NATS_URL=nats://localhost:4222 \
PROJECT_ID=my-project \
AGENT_CAPABILITIES=typescript,python \
./agent-wrappers/claude-code/bootstrap.sh
```

### Copilot CLI

Use the bootstrap script to start a Copilot CLI agent:

```bash
NATS_URL=nats://localhost:4222 \
PROJECT_ID=my-project \
AGENT_CAPABILITIES=typescript,python \
./agent-wrappers/copilot-cli/bootstrap.sh
```

> **Note**: Copilot CLI requires MCP support (preview feature). Ensure Warp is configured as an MCP server in your Copilot CLI settings.

## Configuration

### Environment Variables (Weft)

| Variable | Description | Default |
|----------|-------------|---------|
| `NATS_URL` | NATS server URL (supports credentials in URL) | `nats://localhost:4222` |
| `NATS_USER` | Username for NATS authentication (fallback if not in URL) | (none) |
| `NATS_PASS` | Password for NATS authentication (fallback if not in URL) | (none) |
| `LOOM_PROJECT_ID` | Project ID for isolation | `default` |
| `API_PORT` | REST API port | `3000` |
| `API_HOST` | REST API host | `0.0.0.0` |
| `API_TOKENS` | Comma-separated bearer tokens for API authentication | (none) |
| `IDLE_TIMEOUT_MS` | Idle detection timeout | `300000` |
| `LOG_LEVEL` | Logging level | `info` |

**NATS Connection Behavior:**
- Automatic reconnection enabled with unlimited attempts
- Fixed 2-second delay between reconnection attempts
- Connection state changes are logged for monitoring

### NATS Authentication

Authentication is **optional**. For local development, just use `nats://localhost:4222`.

For production NATS servers with authentication enabled:

**Option 1: Credentials in URL (recommended)**
```bash
NATS_URL=nats://admin:mypassword@nats.example.com:4222
```

**Option 2: Separate environment variables**
```bash
NATS_URL=nats://nats.example.com:4222
NATS_USER=admin
NATS_PASS=mypassword
```

URL credentials take precedence over environment variables. Special characters in passwords should be URL-encoded (e.g., `@` → `%40`, `/` → `%2F`).

### WebSocket Transport

Weft supports WebSocket connections for environments where raw TCP is not available (e.g., through CDN proxies like Cloudflare):

```bash
# WebSocket (for proxied connections)
NATS_URL=wss://admin:mypassword@nats.example.com

# WebSocket without TLS (local testing only)
NATS_URL=ws://localhost:8080
```

The transport is auto-detected from the URL scheme:
- `nats://` or `tls://` → TCP connection
- `ws://` or `wss://` → WebSocket connection

### Shuttle Configuration

Stored in `~/.loom/config.json`:

```json
{
  "natsUrl": "nats://localhost:4222",
  "projectId": "my-project",
  "defaultClassification": "personal",
  "outputFormat": "table"
}
```

## REST API

Weft exposes a REST API for integration:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/agents` | GET | List agents |
| `/api/agents/:guid` | GET | Get agent details |
| `/api/agents/:guid/shutdown` | POST | Request agent shutdown |
| `/api/work` | GET | List work items |
| `/api/work` | POST | Submit work |
| `/api/work/:id` | GET | Get work item |
| `/api/work/:id/cancel` | POST | Cancel work item |
| `/api/targets` | GET | List targets |
| `/api/targets` | POST | Register target |
| `/api/targets/:id` | GET | Get target details |
| `/api/targets/:id` | PUT | Update target |
| `/api/targets/:id` | DELETE | Remove target |
| `/api/targets/:id/test` | POST | Test target health |
| `/api/targets/:id/spin-up` | POST | Trigger target spin-up |
| `/api/targets/:id/disable` | POST | Disable target |
| `/api/targets/:id/enable` | POST | Enable target |
| `/api/stats` | GET | Coordinator stats |
| `/api/stats/projects` | GET | List active projects |
| `/api/channels` | GET | List channels (requires `projectId` query param) |
| `/api/channels/:name/messages` | GET | Read channel messages (requires `projectId` query param) |

## Development

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker (for NATS)

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

### Project Structure

```
coordinator-system/
├── shared/                 # @loom/shared - Types and utilities
├── weft/                   # @loom/weft - Coordinator service
├── shuttle/                # @loom/shuttle - CLI tool
├── agent-wrappers/
│   ├── claude-code/        # Claude Code bootstrap scripts
│   └── copilot-cli/        # Copilot CLI bootstrap scripts
├── docker-compose.yml
└── README.md
```

## Security

Weft is designed for trusted network environments. Consider these security practices:

### Authentication and Authorization
- **REST API**: Currently unauthenticated - deploy behind a reverse proxy with authentication for production
- **NATS**: Supports TLS and credential-based authentication via config file
- **SSH Keys**: Use key-based authentication for SSH spin-up targets
- **API Tokens**: Store GitHub/webhook tokens securely using environment variables or secrets management

### Network Security
- Deploy NATS and Weft on a private network or use TLS for NATS connections
- Use firewall rules to restrict API access to trusted clients
- Consider using VPN or SSH tunnels for remote agent connections

### Secrets Management
- Never commit SSH keys, API tokens, or credentials to version control
- Use environment variables or dedicated secrets managers (HashiCorp Vault, AWS Secrets Manager, etc.)
- For Kubernetes deployments, use Kubernetes Secrets with RBAC controls

### Best Practices
- Regularly rotate SSH keys and API tokens
- Monitor audit logs for unusual activity
- Use least-privilege principles for service accounts
- Keep dependencies up to date to patch security vulnerabilities

## Known Limitations

This is **beta software** ready for early adopters. Known limitations include:

### Scalability
- Single-node deployment only (no HA/clustering yet)
- Target registry stored in-memory (lost on restart)
- No persistent work queue (work items lost if Weft crashes)

### Features
- No authentication/authorization on REST API
- No work prioritization across projects in multi-tenant mode
- Limited observability (metrics/tracing not yet implemented)
- No automatic target health checking (manual test only)

### Agent Management
- Idle detection relies on work completion events (agents may stay running if busy with non-Loom work)
- No graceful shutdown coordination for in-progress work during Weft restart
- SSH-based spin-up assumes agents can reach NATS (no NAT traversal)

### Platform Support
- Kubernetes spin-up tested on standard K8s only (not OpenShift, EKS variants, etc.)
- GitHub Actions spin-up requires public/private repo access (no fine-grained PAT support yet)
- Local spin-up mechanism assumes Unix-like shell environment

### Roadmap
We're actively working on addressing these limitations. See the main [Loom README](../README.md) for the project roadmap.

## Related Components

- **[Loom](../README.md)** — The complete multi-agent infrastructure
- **[Warp](../warp/README.md)** — MCP server for agent messaging

## License

MIT
