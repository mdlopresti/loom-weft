/**
 * Shutdown command - Request agent shutdown
 */

import { Command } from 'commander';
import ora from 'ora';
import type { AgentShutdownRequest } from '@loom/shared';
import { loadConfig } from '../utils/config-file.js';
import { getNATSConnection, closeNATSConnection, CoordinatorSubjects } from '../nats/client.js';
import { output, success, error, warning } from '../utils/output.js';
import { confirm } from '../utils/prompts.js';
import { getGlobalOptions } from '../cli.js';

export function shutdownCommand(): Command {
  const cmd = new Command('shutdown');

  cmd
    .description('Request agent shutdown')
    .argument('<agent-guid>', 'Agent GUID to shutdown')
    .option('--graceful', 'Wait for current work to complete (default: true)', true)
    .option('--force', 'Force immediate shutdown without waiting')
    .option('--grace-period <ms>', 'Grace period in milliseconds', '30000')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (agentGuid: string, options, command) => {
      const globalOpts = getGlobalOptions(command);
      const spinner = ora();

      try {
        const config = loadConfig(globalOpts.config);

        // Confirm shutdown unless --yes flag
        if (!options.yes && !globalOpts.json) {
          const confirmed = await confirm(
            `Are you sure you want to shutdown agent ${agentGuid}?`,
            false
          );
          if (!confirmed) {
            warning('Shutdown cancelled', globalOpts);
            process.exit(0);
          }
        }

        if (!globalOpts.quiet) {
          spinner.start('Sending shutdown request...');
        }

        const nc = await getNATSConnection(config);
        const subjects = new CoordinatorSubjects(config.projectId);

        const shutdownRequest: AgentShutdownRequest = {
          guid: agentGuid,
          reason: 'manual',
          graceful: options.force ? false : options.graceful !== false,
          gracePeriodMs: parseInt(options.gracePeriod, 10),
        };

        const response = await nc.request(
          subjects.agentShutdown(),
          JSON.stringify(shutdownRequest),
          { timeout: 5000 }
        );

        const result = JSON.parse(new TextDecoder().decode(response.data));

        await closeNATSConnection();

        if (!globalOpts.quiet) {
          spinner.succeed('Shutdown request sent');
        }

        // Output results
        if (globalOpts.json) {
          output(result, globalOpts);
        } else {
          if (result.success !== false) {
            success('Agent shutdown requested', globalOpts);
            if (shutdownRequest.graceful) {
              warning(
                `Agent will shutdown after completing current work (max ${
                  shutdownRequest.gracePeriodMs! / 1000
                }s)`,
                globalOpts
              );
            }
          } else {
            error(`Shutdown failed: ${result.error || 'Unknown error'}`, globalOpts);
            process.exit(1);
          }
        }
      } catch (err: any) {
        if (spinner.isSpinning) {
          spinner.fail('Failed to send shutdown request');
        }
        error(`Error: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}
