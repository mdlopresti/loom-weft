/**
 * Config command - Manage CLI configuration
 */

import { Command } from 'commander';
import type { CLIConfiguration } from '@loom/shared';
import {
  loadConfig,
  setConfigValue,
  listConfig,
  getDefaultConfigPath,
  validateConfig,
} from '../utils/config-file.js';
import { output, success, error, formatKeyValue } from '../utils/output.js';
import { getGlobalOptions } from '../cli.js';

export function configCommand(): Command {
  const cmd = new Command('config');

  cmd
    .description('Manage CLI configuration')
    .addCommand(configSetCommand())
    .addCommand(configGetCommand())
    .addCommand(configListCommand())
    .addCommand(configPathCommand());

  return cmd;
}

function configSetCommand(): Command {
  const cmd = new Command('set');

  cmd
    .description('Set a configuration value')
    .argument('<key>', 'Configuration key')
    .argument('<value>', 'Configuration value')
    .action(async (key: string, value: string, _options, command) => {
      try {
        const globalOpts = getGlobalOptions(command);

        // Validate key is a valid config property
        const validKeys: (keyof CLIConfiguration)[] = [
          'natsUrl',
          'projectId',
          'defaultBoundary',
          'defaultPriority',
          'outputFormat',
          'apiUrl',
          'apiToken',
        ];

        if (!validKeys.includes(key as keyof CLIConfiguration)) {
          error(`Invalid config key: ${key}`, globalOpts);
          error(`Valid keys: ${validKeys.join(', ')}`, globalOpts);
          process.exit(1);
        }

        // Parse value based on key
        let parsedValue: any = value;
        if (key === 'defaultPriority') {
          parsedValue = parseInt(value, 10);
          if (isNaN(parsedValue)) {
            error('defaultPriority must be a number', globalOpts);
            process.exit(1);
          }
        }

        // Validate the config value
        const errors = validateConfig({ [key]: parsedValue });
        if (errors.length > 0) {
          error('Configuration validation failed:', globalOpts);
          errors.forEach((err) => error(`  - ${err}`, globalOpts));
          process.exit(1);
        }

        setConfigValue(key as keyof CLIConfiguration, parsedValue, globalOpts.config);
        success(`Set ${key} = ${parsedValue}`, globalOpts);
      } catch (err: any) {
        error(`Failed to set config: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}

function configGetCommand(): Command {
  const cmd = new Command('get');

  cmd
    .description('Get a configuration value')
    .argument('<key>', 'Configuration key')
    .action(async (key: string, _options, command) => {
      try {
        const globalOpts = getGlobalOptions(command);
        const config = loadConfig(globalOpts.config);

        if (!(key in config)) {
          error(`Unknown config key: ${key}`, globalOpts);
          process.exit(1);
        }

        const value = config[key as keyof CLIConfiguration];

        if (globalOpts.json) {
          output({ [key]: value }, globalOpts);
        } else {
          output(value !== undefined ? String(value) : '(not set)', globalOpts);
        }
      } catch (err: any) {
        error(`Failed to get config: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}

function configListCommand(): Command {
  const cmd = new Command('list');

  cmd
    .description('List all configuration values')
    .alias('ls')
    .action(async (_options, command) => {
      try {
        const globalOpts = getGlobalOptions(command);
        const config = listConfig(globalOpts.config);

        if (globalOpts.json) {
          output(config, globalOpts);
        } else {
          const displayConfig: Record<string, any> = {};
          Object.entries(config).forEach(([key, value]) => {
            displayConfig[key] = value !== undefined ? value : '(not set)';
          });

          if (!globalOpts.quiet) {
            console.log('Current configuration:');
            console.log(formatKeyValue(displayConfig));
          }
        }
      } catch (err: any) {
        error(`Failed to list config: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}

function configPathCommand(): Command {
  const cmd = new Command('path');

  cmd
    .description('Show the configuration file path')
    .action((_options, command) => {
      const globalOpts = getGlobalOptions(command);
      const path = globalOpts.config || getDefaultConfigPath();

      if (globalOpts.json) {
        output({ configPath: path }, globalOpts);
      } else {
        output(path, globalOpts);
      }
    });

  return cmd;
}
