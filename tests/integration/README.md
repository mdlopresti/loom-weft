# Integration Tests

This directory contains end-to-end integration tests for the Loom coordinator system.

## Prerequisites

- Node.js 20+
- Docker (for NATS server)
- pnpm

## Quick Start

```bash
# Start NATS server with JetStream
docker run -d --name nats -p 4222:4222 -p 8222:8222 nats:latest -js

# Install dependencies
cd tests
pnpm install

# Run integration tests
pnpm test:integration

# Or run with custom NATS URL
NATS_URL=nats://your-server:4222 RUN_INTEGRATION=true pnpm test
```

## Test Files

| File | Description |
|------|-------------|
| `agent-lifecycle.test.ts` | Agent registration, status updates, discovery, heartbeat |
| `work-queue.test.ts` | Work submission, claiming, completion events |
| `target-management.test.ts` | Target registration and linking (planned) |
| `failure-scenarios.test.ts` | Error handling and recovery (planned) |

## Test Scenarios

### Agent Lifecycle (`agent-lifecycle.test.ts`)

- ✅ Register an agent in KV store
- ✅ Update agent status (online → busy → offline)
- ✅ Deregister an agent
- ✅ Discover agents by scanning KV
- ✅ Filter agents by capability
- ✅ Heartbeat timestamp updates

### Work Queue (`work-queue.test.ts`)

- ✅ Publish work to capability queue
- ✅ Work with different priorities
- ✅ Create consumer for capability
- ✅ Competing consumers
- ✅ Completion events
- ✅ Error events
- ✅ Stream operations (info, purge)

### Planned Tests

**Target Management:**
- Register a spin-up target
- Assign agent to target
- Verify target state
- Unassign agent
- Deregister target

**Failure Scenarios:**
- Agent dies without deregistering (GC cleanup)
- Work fails after max attempts (DLQ)
- DLQ retry moves back to queue
- Work timeout handling

**Multi-Agent:**
- Competing consumers for same work
- Agent failover during work execution
- Spin-up deduplication under load

## CI Integration

These tests are skipped by default unless `RUN_INTEGRATION=true` is set.
This allows regular unit tests to run without a NATS dependency.

For CI, use a service container:

```yaml
services:
  nats:
    image: nats:latest
    ports:
      - 4222:4222
    options: --js

steps:
  - run: RUN_INTEGRATION=true pnpm test
    env:
      NATS_URL: nats://localhost:4222
```

## Cleanup

```bash
# Stop and remove NATS container
docker stop nats && docker rm nats
```
