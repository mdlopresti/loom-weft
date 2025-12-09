/**
 * CLI command setup using Commander.js
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { configCommand } from './commands/config.js';
import { submitCommand } from './commands/submit.js';
import { agentsCommand } from './commands/agents.js';
import { workCommand } from './commands/work.js';
import { watchCommand } from './commands/watch.js';
import { statsCommand } from './commands/stats.js';
import { spinUpCommand } from './commands/spin-up.js';
import { shutdownCommand } from './commands/shutdown.js';
import { targetsCommand } from './commands/targets.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

export interface GlobalOptions {
  json?: boolean;
  config?: string;
  quiet?: boolean;
}

export function createCLI(): Command {
  const program = new Command();

  program
    .name('coord')
    .description('CLI tool for submitting work and managing the coordinator system')
    .version(packageJson.version);

  // Global options
  program
    .option('--json', 'Output as JSON instead of formatted tables')
    .option('--config <path>', 'Path to config file (default: ~/.loom/config.json)')
    .option('-q, --quiet', 'Suppress non-essential output');

  // Register commands
  program.addCommand(configCommand());
  program.addCommand(submitCommand());
  program.addCommand(agentsCommand());
  program.addCommand(workCommand());
  program.addCommand(watchCommand());
  program.addCommand(statsCommand());
  program.addCommand(spinUpCommand());
  program.addCommand(shutdownCommand());
  program.addCommand(targetsCommand());

  return program;
}

/**
 * Get global options from the parent command
 */
export function getGlobalOptions(command: Command): GlobalOptions {
  const parent = command.parent;
  if (!parent) {
    return {};
  }

  return {
    json: parent.opts().json,
    config: parent.opts().config,
    quiet: parent.opts().quiet,
  };
}
