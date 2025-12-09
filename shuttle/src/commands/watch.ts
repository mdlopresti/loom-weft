/**
 * Watch command - Watch a work item's progress in real-time
 */

import { Command } from 'commander';
import ora from 'ora';
import type { CoordinatedWorkItem } from '@loom/shared';
import { loadConfig } from '../utils/config-file.js';
import { getNATSConnection, closeNATSConnection, CoordinatorSubjects } from '../nats/client.js';
import { output, error, info, colorStatus } from '../utils/output.js';
import { getGlobalOptions } from '../cli.js';

export function watchCommand(): Command {
  const cmd = new Command('watch');

  cmd
    .description('Watch a work item\'s progress in real-time')
    .argument('<work-id>', 'Work item ID to watch')
    .option('--interval <seconds>', 'Polling interval in seconds', '2')
    .action(async (workId: string, options, command) => {
      const globalOpts = getGlobalOptions(command);
      const spinner = ora();
      let lastStatus = '';

      try {
        const config = loadConfig(globalOpts.config);
        const pollInterval = parseInt(options.interval, 10) * 1000;

        if (!globalOpts.quiet) {
          info(`Watching work item ${workId} (press Ctrl+C to stop)`, globalOpts);
          console.log();
        }

        const nc = await getNATSConnection(config);
        const subjects = new CoordinatorSubjects(config.projectId);

        // Poll for updates
        const poll = async () => {
          try {
            const response = await nc.request(
              subjects.workStatus(workId),
              JSON.stringify({}),
              { timeout: 5000 }
            );

            const workItem: CoordinatedWorkItem = JSON.parse(
              new TextDecoder().decode(response.data)
            );

            // Check if status changed
            if (workItem.status !== lastStatus) {
              lastStatus = workItem.status;

              const statusText = colorStatus(workItem.status);
              const progressText =
                workItem.progress !== undefined ? ` (${workItem.progress}%)` : '';

              if (!globalOpts.json) {
                spinner.text = `Status: ${statusText}${progressText}`;

                if (workItem.status === 'completed') {
                  spinner.succeed('Work completed successfully!');
                  if (workItem.result?.summary) {
                    console.log(`Summary: ${workItem.result.summary}`);
                  }
                  await closeNATSConnection();
                  process.exit(0);
                } else if (workItem.status === 'failed') {
                  spinner.fail('Work failed');
                  if (workItem.error?.message) {
                    error(`Error: ${workItem.error.message}`, globalOpts);
                  }
                  await closeNATSConnection();
                  process.exit(1);
                } else if (workItem.status === 'cancelled') {
                  spinner.warn('Work was cancelled');
                  await closeNATSConnection();
                  process.exit(0);
                } else {
                  if (!spinner.isSpinning) {
                    spinner.start(statusText);
                  }
                }
              } else {
                output({ status: workItem.status, progress: workItem.progress }, globalOpts);
              }
            }
          } catch (err: any) {
            if (!globalOpts.quiet) {
              spinner.warn(`Failed to fetch status: ${err.message}`);
            }
          }

          // Schedule next poll
          setTimeout(poll, pollInterval);
        };

        // Start polling
        await poll();
      } catch (err: any) {
        if (spinner.isSpinning) {
          spinner.fail('Failed to watch work item');
        }
        error(`Error: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}
