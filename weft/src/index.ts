#!/usr/bin/env node
/**
 * Coordinator Service Entry Point
 *
 * This service coordinates work distribution across Claude Code and
 * GitHub Copilot CLI agents running on different computers.
 */

import { startService } from './service.js';

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the service
startService().catch((error) => {
  console.error('Failed to start coordinator service:', error);
  process.exit(1);
});
