#!/usr/bin/env node

/**
 * CLI tool for the coordinator system
 * Entry point for the coord CLI command
 */

import { createCLI } from './cli.js';

async function main() {
  const cli = createCLI();
  await cli.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
