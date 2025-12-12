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
import { projectsCommand } from './commands/projects.js';
import { channelsCommand } from './commands/channels.js';

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
  project?: string;
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
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('-p, --project <id>', 'Project ID to operate on (overrides config)');

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
  program.addCommand(projectsCommand());
  program.addCommand(channelsCommand());

  return program;
}

/**
 * Get global options from the root command
 * Traverses up the command chain to find the root program
 */
export function getGlobalOptions(command: Command): GlobalOptions {
  // Find root command by traversing parents
  let root = command;
  while (root.parent) {
    root = root.parent;
  }

  const opts = root.opts();
  return {
    json: opts.json,
    config: opts.config,
    quiet: opts.quiet,
    project: opts.project,
  };
}
