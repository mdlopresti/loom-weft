/**
 * Stats command - Show coordinator statistics
 */

import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../utils/config-file.js';
import { getNATSConnection, closeNATSConnection, CoordinatorSubjects } from '../nats/client.js';
import { output, error, formatKeyValue, colorStatus } from '../utils/output.js';
import { getGlobalOptions } from '../cli.js';

interface CoordinatorStats {
  agents: {
    total: number;
    online: number;
    busy: number;
    offline: number;
    byType: Record<string, number>;
  };
  work: {
    pending: number;
    assigned: number;
    inProgress: number;
    completed: number;
    failed: number;
    totalSubmitted: number;
  };
  targets: {
    total: number;
    available: number;
    inUse: number;
    disabled: number;
    byMechanism: Record<string, number>;
  };
  performance: {
    averageWaitTimeMs?: number;
    averageCompletionTimeMs?: number;
    successRate?: number;
  };
}

export function statsCommand(): Command {
  const cmd = new Command('stats');

  cmd
    .description('Show coordinator statistics')
    .action(async (_options, command) => {
      const globalOpts = getGlobalOptions(command);
      const spinner = ora();

      try {
        const config = loadConfig(globalOpts.config);

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

          // Agents
          console.log('\nAgents:');
          console.log(
            formatKeyValue({
              'Total': stats.agents.total,
              'Online': colorStatus('online') + ` (${stats.agents.online})`,
              'Busy': colorStatus('busy') + ` (${stats.agents.busy})`,
              'Offline': colorStatus('offline') + ` (${stats.agents.offline})`,
            })
          );

          if (Object.keys(stats.agents.byType).length > 0) {
            console.log('\n  By Type:');
            console.log(formatKeyValue(stats.agents.byType));
          }

          // Work Items
          console.log('\nWork Items:');
          console.log(
            formatKeyValue({
              'Pending': stats.work.pending,
              'Assigned': stats.work.assigned,
              'In Progress': stats.work.inProgress,
              'Completed': stats.work.completed,
              'Failed': stats.work.failed,
              'Total Submitted': stats.work.totalSubmitted,
            })
          );

          // Targets
          console.log('\nSpin-Up Targets:');
          console.log(
            formatKeyValue({
              'Total': stats.targets.total,
              'Available': stats.targets.available,
              'In Use': stats.targets.inUse,
              'Disabled': stats.targets.disabled,
            })
          );

          if (Object.keys(stats.targets.byMechanism).length > 0) {
            console.log('\n  By Mechanism:');
            console.log(formatKeyValue(stats.targets.byMechanism));
          }

          // Performance
          if (stats.performance) {
            console.log('\nPerformance:');
            const perfMetrics: Record<string, string> = {};

            if (stats.performance.averageWaitTimeMs !== undefined) {
              perfMetrics['Average Wait Time'] = `${Math.round(
                stats.performance.averageWaitTimeMs / 1000
              )}s`;
            }

            if (stats.performance.averageCompletionTimeMs !== undefined) {
              perfMetrics['Average Completion Time'] = `${Math.round(
                stats.performance.averageCompletionTimeMs / 1000
              )}s`;
            }

            if (stats.performance.successRate !== undefined) {
              perfMetrics['Success Rate'] = `${(stats.performance.successRate * 100).toFixed(
                1
              )}%`;
            }

            if (Object.keys(perfMetrics).length > 0) {
              console.log(formatKeyValue(perfMetrics));
            }
          }

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
