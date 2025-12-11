# Changelog

All notable changes to Shuttle (CLI) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-12-11

### Status: Beta Release

This release marks the transition from Alpha to Beta. Core CLI functionality has been tested against Weft coordinator.

### Added
- **REST API client**: All commands now use Weft REST API instead of direct NATS
- **Work submission**: `shuttle submit` with boundary, capability, priority, deadline options
- **Agent management**: `shuttle agents list` with filtering by type, status, capability
- **Work monitoring**: `shuttle work list`, `shuttle work show`, `shuttle work cancel`
- **Real-time watch**: `shuttle watch <work-id>` for progress monitoring
- **Target management**: Full CRUD for spin-up targets (add, show, update, remove, enable, disable, test)
- **Statistics**: `shuttle stats` shows coordinator metrics
- **Projects**: `shuttle projects` lists active projects in multi-tenant mode
- **Configuration**: `shuttle config` for managing CLI settings
- **Output formats**: Table (default) and JSON (`--json` flag)
- **Global options**: `--project`, `--config`, `--quiet`

### Changed
- Migrated from direct NATS to REST API communication
- Renamed `classification` to `boundary` for work routing
- Commands now require Weft coordinator to be running

### Integration Tests Passed
- 5/5 Configuration tests (REQ-CLI-CFG)
- 3/3 Agent command tests (REQ-CLI-AGENT)
- 3/3 Work command tests (REQ-CLI-WORK)
- 4/4 Target command tests (REQ-CLI-TARGET)
- 2/2 Stats/Projects tests (REQ-CLI-INFO)
- JSON output verified across all commands

### Known Limitations
- No offline mode
- No batch operations
- Watch uses polling (no streaming)
- Interactive mode has basic validation

---

[0.1.0]: https://github.com/mdlopresti/loom-weft/releases/tag/v0.1.0
