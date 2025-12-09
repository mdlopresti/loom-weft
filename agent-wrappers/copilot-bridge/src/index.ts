#!/usr/bin/env node

/**
 * Copilot Bridge - NATS to GitHub Copilot CLI bridge
 *
 * This service connects to NATS and processes work items by invoking
 * the GitHub Copilot CLI.
 */

import { startBridge } from './bridge.js';

async function main() {
  try {
    // Get config path from command line arg if provided
    const configPath = process.argv[2];

    await startBridge(configPath);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Export for programmatic use
export { startBridge } from './bridge.js';
export { loadConfig, printConfig } from './config.js';
export type { BridgeConfig } from './config.js';
export {
  registerSelfAsTarget,
  linkAgentToTarget,
  unlinkAgentFromTarget,
} from './target-registration.js';
