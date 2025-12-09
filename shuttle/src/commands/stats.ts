/**
 * Stats command - Show coordinator statistics
 */

import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../utils/config-file.js';
import { getNATSConnection, closeNATSConnection, CoordinatorSubjects } from '../nats/client.js';
import { output, error, formatKeyValue, colorStatus } from '../utils/output.js';
import { getGlobalOptions } from '../cli.js';

/**
 * Stats returned by the coordinator
 */
interface CoordinatorStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
}

export function statsCommand(): Command {
  const cmd = new Command('stats');

  cmd
    .description('Show coordinator statistics')
    .action(async (_options, command) => {
      const globalOpts = getGlobalOptions(command);
      const spinner = ora();

      try {
        const config = loadConfig({
          configPath: globalOpts.config,
          projectOverride: globalOpts.project,
        });

        if (!globalOpts.quiet) {
          spinner.start('Fetching statistics...');
        }

        const nc = await getNATSConnection(config);
        const subjects = new CoordinatorSubjects(config.projectId);

        const response = await nc.request(
          subjects.stats(),
          JSON.stringify({}),
          { timeout: 5000 }
        );

        const stats: CoordinatorStats = JSON.parse(
          new TextDecoder().decode(response.data)
        );

        await closeNATSConnection();

        if (!globalOpts.quiet) {
          spinner.succeed('Statistics retrieved');
        }

        // Output results
        if (globalOpts.json) {
          output(stats, globalOpts);
        } else {
          console.log('\nCoordinator Statistics');
          console.log('='.repeat(50));

          // Work Items
          console.log('\nWork Items:');
          console.log(
            formatKeyValue({
              'Pending': colorStatus('pending') + ` (${stats.pending})`,
              'Active': colorStatus('busy') + ` (${stats.active})`,
              'Completed': colorStatus('online') + ` (${stats.completed})`,
              'Failed': colorStatus('offline') + ` (${stats.failed})`,
              'Total': stats.total,
            })
          );

          console.log();
        }
      } catch (err: any) {
        if (spinner.isSpinning) {
          spinner.fail('Failed to fetch statistics');
        }
        error(`Error: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}
