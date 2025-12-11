# Changelog

All notable changes to Weft (coordinator) and Shuttle (CLI) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0-beta] - 2025-12-11

### Added
- **Multi-tenant support**: Single Weft instance serves multiple projects via auto-discovery
- **Dynamic spin-up**: Automatic agent spawning when work arrives with no available agents
- **Target registry**: CRUD operations for spin-up targets (SSH, local, Kubernetes, GitHub Actions, webhook)
- **Idle detection**: Infrastructure for detecting and scaling down idle agents
- **REST API**: Full REST API for agents, work, targets, and stats
- **Project-level stats**: Per-project and global statistics endpoints
- **NATS KV integration**: Agent registry backed by NATS JetStream KV bucket

### Changed
- Upgraded from single-project to multi-project architecture
- Work routing now uses `boundary` field (was `classification`)
- API authentication now optional via `API_TOKENS` environment variable

### Fixed
- KV bucket initialization now properly called during project context creation
- Agent registry uses correct bucket name `agent-registry`

### Integration Tests Passed
- 5/5 Basic API tests (REQ-WEFT-BASIC)
- 4/5 Work routing tests (REQ-ROUTE) - minor field naming issue
- 14/14 Target registry tests (REQ-TARGET)
- 6/6 Dynamic spin-up tests (REQ-SPINUP)
- 7/7 Idle detection tests (REQ-IDLE)
- 5/5 Multi-tenant tests (REQ-TENANT)
- 5/5 End-to-end integration tests (REQ-E2E)
- 6/6 Failure recovery tests (REQ-FAIL)

### Security
- 0 high/critical vulnerabilities
- 1 moderate vulnerability in dev dependencies (esbuild via vitest)

## [1.2.0-alpha] - 2025-12-10

### Added
- Initial coordinator implementation
- Basic work routing by classification
- In-memory work tracking
- Agent lifecycle management via NATS KV watch

### Known Issues
- Single-node deployment only
- In-memory state lost on restart
- No REST API authentication
