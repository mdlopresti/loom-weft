# Shuttle

**Command-line control for Loom.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Beta](https://img.shields.io/badge/Status-Beta-blue.svg)](https://github.com/mdlopresti/loom-weft/releases)

Shuttle is the CLI tool for [Loom](../../README.md) — submit work, manage agents, and monitor your fleet from the terminal.

> **🔷 Beta Software**: This project has passed integration testing and is suitable for early adopters. Core functionality is stable. Feedback welcome!

> **Shuttle** (noun): In weaving, the shuttle carries the weft thread back and forth across the loom, creating the fabric.

## Installation

```bash
# npm (global)
npm install -g @loom/shuttle

# Or build locally
pnpm install
pnpm build
pnpm link --global
```

## Quick Start

```bash
# Configure
shuttle config set apiUrl http://localhost:3000
shuttle config set projectId my-project

# Submit work
shuttle submit "Implement new feature" \
  --boundary personal \
  --capability typescript

# Watch progress
shuttle watch <work-id>

# View stats
shuttle stats
```

## Configuration

Shuttle stores configuration in `~/.loom/config.json`. Environment variables override file configuration.

### Configuration Commands

```bash
shuttle config set <key> <value>   # Set a value
shuttle config get <key>           # Get a value
shuttle config list                # List all config
shuttle config path                # Show config file path
```

### Configuration Options

| Key | Description | Default | Env Variable |
|-----|-------------|---------|--------------|
| `apiUrl` | Weft coordinator API URL | `http://localhost:3000` | `LOOM_API_URL` |
| `apiToken` | API auth token (optional) | - | `LOOM_API_TOKEN` |
| `projectId` | Project ID for isolation | `default` | `PROJECT_ID` |
| `defaultBoundary` | Default work boundary | - | - |
| `defaultPriority` | Default priority (1-10) | `5` | - |
| `outputFormat` | Output format (`table`/`json`) | `table` | - |

## Global Options

All commands support:

- `--json` — Output as JSON instead of formatted tables
- `--config <path>` — Custom config file path
- `-q, --quiet` — Suppress non-essential output

## Commands

### Work Submission

```bash
# Interactive mode
shuttle submit --interactive

# With flags
shuttle submit "Implement user auth" \
  --boundary personal \
  --capability typescript \
  --priority 8 \
  --agent-type claude-code \
  --deadline "2024-12-10T17:00:00Z"

# Minimal (uses config defaults)
shuttle submit "Fix bug" --boundary corporate --capability typescript
```

**Options:**

| Option | Description |
|--------|-------------|
| `--boundary <name>` | Work boundary (user-defined, e.g., `personal`, `corporate`) |
| `--capability <name>` | Required capability (e.g., `typescript`, `python`) |
| `--priority <n>` | Priority 1-10 (default: 5) |
| `--agent-type <type>` | `copilot-cli` or `claude-code` |
| `--deadline <iso>` | Deadline in ISO 8601 format |
| `--interactive` | Interactive mode with prompts |

### Agent Management

```bash
# List agents
shuttle agents list
shuttle agents list --type claude-code
shuttle agents list --status online
shuttle agents list --capability typescript

# Shutdown agent
shuttle shutdown <agent-guid>
shuttle shutdown <agent-guid> --force
shuttle shutdown <agent-guid> --grace-period 60000
shuttle shutdown <agent-guid> -y  # Skip confirmation

# Spin up agent
shuttle spin-up --target home-claude
shuttle spin-up --type claude-code --capability typescript
shuttle spin-up --classification personal --capability python
```

### Work Monitoring

```bash
# List work
shuttle work list
shuttle work list --status pending
shuttle work list --boundary personal

# Show work details
shuttle work show <work-id>

# Cancel work
shuttle work cancel <work-id>

# Watch progress (real-time)
shuttle watch <work-id>
shuttle watch <work-id> --interval 5
```

### Target Management

Targets define how to spin up agents.

```bash
# List targets
shuttle targets list
shuttle targets list --type claude-code
shuttle targets list --status available
shuttle targets list --mechanism ssh

# Show target details
shuttle targets show <name-or-id>

# Add target (interactive)
shuttle targets add

# Add SSH target
shuttle targets add \
  --name home-claude \
  --type claude-code \
  --mechanism ssh \
  --host home.example.com \
  --user mike \
  --command "./bootstrap.sh" \
  --capabilities typescript,python \
  --boundaries personal,open-source

# Add local process target
shuttle targets add \
  --name local-copilot \
  --type copilot-cli \
  --mechanism local \
  --command "./agent-wrappers/copilot-cli/bootstrap.sh" \
  --capabilities general \
  --boundaries corporate,corporate-adjacent

# Update target
shuttle targets update home-claude --capabilities typescript,python,go
shuttle targets update home-claude --boundaries personal,open-source

# Remove target
shuttle targets remove <name>
shuttle targets rm <name> -y  # Skip confirmation

# Enable/disable
shuttle targets enable <name>
shuttle targets disable <name>

# Test health
shuttle targets test <name>
shuttle targets test --all
```

### Statistics

```bash
shuttle stats
```

Displays:
- Agent counts by type and status
- Work item counts by status
- Target counts by mechanism
- Performance metrics

### Projects

```bash
# List all active projects across the coordinator
shuttle projects
```

## Work Boundaries

Boundaries are user-defined labels for routing work to appropriate agents. Common examples:

| Boundary | Description | Typical Routing |
|----------|-------------|-----------------|
| `corporate` | Requires corporate access | Copilot CLI only |
| `corporate-adjacent` | Work-related, no sensitive data | Copilot preferred |
| `personal` | Personal projects | Claude Code preferred |
| `open-source` | Public repositories | Any agent |

> **Note**: Boundaries are fully customizable. Define your own based on your workflow needs.

## Spin-Up Mechanisms

| Mechanism | Description |
|-----------|-------------|
| `ssh` | Execute command on remote host via SSH |
| `local` | Spawn local process |
| `kubernetes` | Create Kubernetes Job |
| `github-actions` | Trigger GitHub Actions workflow |
| `webhook` | Call HTTP webhook |

## Examples

### Complete Workflow

```bash
# 1. Configure
shuttle config set apiUrl http://localhost:3000
shuttle config set projectId my-project

# 2. Add a target
shuttle targets add \
  --name home-claude \
  --type claude-code \
  --mechanism ssh \
  --host home.example.com \
  --user mike \
  --command "./start-claude.sh" \
  --capabilities typescript,python \
  --boundaries personal,open-source

# 3. Test target
shuttle targets test home-claude

# 4. Submit work
shuttle submit "Add dark mode toggle" \
  --classification personal \
  --capability typescript \
  --priority 7

# 5. Watch progress
shuttle watch <work-id>

# 6. View stats
shuttle stats
```

### Corporate Workflow

```bash
# Add Copilot target
shuttle targets add \
  --name work-copilot \
  --type copilot-cli \
  --mechanism local \
  --command "./agent-wrappers/copilot-cli/bootstrap.sh" \
  --capabilities typescript,python \
  --boundaries corporate,corporate-adjacent

# Submit corporate work (auto-routed to Copilot)
shuttle submit "Update database schema" \
  --classification corporate \
  --capability typescript \
  --priority 9

# Check agents
shuttle agents list
```

### JSON Output

```bash
# Get agents as JSON
shuttle agents list --json

# Pipe to jq
shuttle agents list --json | jq '.[] | select(.status == "online")'

# Get work status as JSON
shuttle work show <work-id> --json
```

## Troubleshooting

### Connection Issues

```bash
# Test API connection
shuttle stats

# Check configuration
shuttle config list

# Override with env var
LOOM_API_URL=http://other-server:3000 shuttle agents list
```

### Target Issues

```bash
# Check target health
shuttle targets test <name>

# View target details and last error
shuttle targets get <name>

# Test all targets
shuttle targets test --all
```

### Work Item Stuck

```bash
# View work item details
shuttle work show <work-id>

# Check available agents
shuttle agents list --status online

# Manually trigger spin-up
shuttle spin-up --capability <required-capability>
```

## Development

```bash
pnpm install          # Install deps
pnpm dev -- <cmd>     # Run in dev mode
pnpm build            # Build for production
pnpm test             # Run tests
pnpm typecheck        # Type check
pnpm lint             # Lint
```

## Architecture

Shuttle communicates with the Weft coordinator via REST API:

- **Configuration** — `~/.loom/config.json`
- **API Communication** — HTTP REST calls to Weft coordinator
- **Output** — Tables via `cli-table3` or JSON
- **Interactive** — Prompts via `inquirer`
- **Progress** — Spinners via `ora`
- **Colors** — Terminal colors via `chalk`

## Known Limitations

This is **beta software** ready for early adopters. Known limitations include:

- **No offline mode**: Requires connection to Weft coordinator for all operations
- **No work queue persistence**: If Weft restarts, work item state may be lost
- **Limited progress reporting**: `shuttle watch` polls at intervals; no streaming updates
- **No batch operations**: Commands operate on single items (no `shuttle submit --batch`)
- **Interactive mode basic**: `--interactive` mode has limited validation

## Related

- **[Loom](../../README.md)** — Complete multi-agent infrastructure
- **[Warp](../../warp/README.md)** — MCP server for agent messaging
- **[Weft](../README.md)** — Coordinator service

## License

MIT
