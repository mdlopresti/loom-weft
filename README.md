# Weft + Shuttle

**Intelligent coordination for Loom.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

This package contains the orchestration layer for [Loom](../README.md) — the coordinator service (Weft) and command-line tool (Shuttle) that weave work through your agent fabric.

> **⚠️ Alpha Software**: This project is under active development and is not yet production-ready. APIs may change without notice, and there may be bugs or missing features. Use at your own risk. Contributions and feedback are welcome!

> **Weft** (noun): In weaving, the weft threads are the horizontal threads that weave through the warp, creating the pattern.
>
> **Shuttle** (noun): The tool that carries the weft thread back and forth across the loom.

## Overview

| Component | Purpose |
|-----------|---------|
| **Weft** | Coordinator service — routes work, manages agent lifecycle, handles scaling |
| **Shuttle** | CLI tool — submit work, manage agents, monitor your fleet |

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

```bash
cd coordinator-system
docker-compose up -d
```

### 2. Install Shuttle

```bash
npm install -g @loom/shuttle

# Or build locally
cd shuttle
pnpm install && pnpm build
pnpm link --global
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

| Command | Description |
|---------|-------------|
| `shuttle submit <task>` | Submit work to the coordinator |
| `shuttle agents list` | List registered agents |
| `shuttle agents shutdown <guid>` | Request agent shutdown |
| `shuttle work list` | List work items |
| `shuttle watch <id>` | Watch work progress in real-time |
| `shuttle targets list` | List spin-up targets |
| `shuttle targets add` | Add a new target |
| `shuttle targets remove <name>` | Remove a target |
| `shuttle targets enable <name>` | Enable a disabled target |
| `shuttle targets disable <name>` | Disable a target |
| `shuttle spin-up <target>` | Manually trigger spin-up |
| `shuttle stats` | View coordinator statistics |
| `shuttle config` | Manage CLI configuration |

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
| `@loom/copilot-bridge` | NATS bridge for Copilot CLI |

## Agent Wrappers

### Claude Code

Use the bootstrap script to start a Claude Code agent:

```bash
NATS_URL=nats://localhost:4222 \
PROJECT_ID=my-project \
AGENT_CAPABILITIES=typescript,python \
./agent-wrappers/claude-code/bootstrap.sh
```

### Copilot CLI

Use the copilot-bridge to connect Copilot CLI to Weft:

```bash
cd agent-wrappers/copilot-bridge
NATS_URL=nats://localhost:4222 \
PROJECT_ID=my-project \
pnpm start
```

## Configuration

### Environment Variables (Weft)

| Variable | Description | Default |
|----------|-------------|---------|
| `NATS_URL` | NATS server URL | `nats://localhost:4222` |
| `LOOM_PROJECT_ID` | Project ID for isolation | `default` |
| `API_PORT` | REST API port | `3000` |
| `API_HOST` | REST API host | `0.0.0.0` |
| `IDLE_TIMEOUT_MS` | Idle detection timeout | `300000` |
| `LOG_LEVEL` | Logging level | `info` |

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
| `/api/work` | GET | List work items |
| `/api/work` | POST | Submit work |
| `/api/work/:id` | GET | Get work item |
| `/api/targets` | GET | List targets |
| `/api/targets` | POST | Register target |
| `/api/stats` | GET | Coordinator stats |

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
│   └── copilot-bridge/     # Copilot CLI NATS bridge
├── docker-compose.yml
└── README.md
```

## Related Components

- **[Loom](../README.md)** — The complete multi-agent infrastructure
- **[Warp](../warp/README.md)** — MCP server for agent messaging

## License

MIT
