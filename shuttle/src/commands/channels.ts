/**
 * Channels command - List channels and read messages
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../utils/config-file.js';
import { createAPIClient } from '../api/client.js';
import {
  output,
  error,
  createTable,
} from '../utils/output.js';
import { getGlobalOptions } from '../cli.js';

export function channelsCommand(): Command {
  const cmd = new Command('channels');

  cmd.description('List channels and read messages');

  // List channels subcommand
  cmd
    .command('list')
    .description('List available channels')
    .action(async (_options, command) => {
      const globalOpts = getGlobalOptions(command);
      const spinner = ora();

      try {
        const config = loadConfig({
          configPath: globalOpts.config,
          projectOverride: globalOpts.project,
        });

        if (!config.projectId) {
          throw new Error('Project ID is required. Set it with: shuttle config set projectId <id>');
        }

        if (!globalOpts.quiet) {
          spinner.start('Fetching channels...');
        }

        const client = createAPIClient(config);
        const response = await client.listChannels(config.projectId);

        if (!response.ok) {
          throw new Error(response.error || `HTTP ${response.status}`);
        }

        const channels = response.data?.channels || [];

        if (!globalOpts.quiet) {
          spinner.succeed(`Found ${channels.length} channel(s)`);
        }

        // Output results
        if (globalOpts.json) {
          output({ channels, projectId: config.projectId }, globalOpts);
        } else {
          if (channels.length === 0) {
            console.log('No channels found');
            return;
          }

          const table = createTable(
            ['Channel', 'Description'],
            channels.map((channel: any) => [
              chalk.cyan(`#${channel.name}`),
              channel.description || '-',
            ])
          );

          console.log(table.toString());
        }
      } catch (err: any) {
        if (spinner.isSpinning) {
          spinner.fail('Failed to fetch channels');
        }
        error(`Error: ${err.message}`, {});
        process.exit(1);
      }
    });

  // Read messages subcommand
  cmd
    .command('read <channel>')
    .description('Read messages from a channel')
    .option('-n, --limit <number>', 'Maximum number of messages to read', '50')
    .action(async (channel: string, options, command) => {
      const globalOpts = getGlobalOptions(command);
      const spinner = ora();

      try {
        const config = loadConfig({
          configPath: globalOpts.config,
          projectOverride: globalOpts.project,
        });

        if (!config.projectId) {
          throw new Error('Project ID is required. Set it with: shuttle config set projectId <id>');
        }

        const limit = parseInt(options.limit, 10) || 50;

        if (!globalOpts.quiet) {
          spinner.start(`Reading messages from #${channel}...`);
        }

        const client = createAPIClient(config);
        const response = await client.readChannelMessages(
          config.projectId,
          channel,
          limit
        );

        if (!response.ok) {
          throw new Error(response.error || `HTTP ${response.status}`);
        }

        const messages = response.data?.messages || [];

        if (!globalOpts.quiet) {
          spinner.succeed(`Found ${messages.length} message(s) in #${channel}`);
        }

        // Output results
        if (globalOpts.json) {
          output({ channel, messages, projectId: config.projectId }, globalOpts);
        } else {
          if (messages.length === 0) {
            console.log(`No messages in #${channel}`);
            return;
          }

          console.log('');
          for (const msg of messages) {
            const timestamp = new Date(msg.timestamp).toLocaleString();
            console.log(
              chalk.dim(`[${timestamp}]`) +
              ' ' +
              chalk.bold.blue(msg.handle) +
              ': ' +
              msg.message
            );
          }
          console.log('');
        }
      } catch (err: any) {
        if (spinner.isSpinning) {
          spinner.fail(`Failed to read messages from #${channel}`);
        }
        error(`Error: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}
