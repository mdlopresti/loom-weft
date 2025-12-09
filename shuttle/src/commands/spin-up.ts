/**
 * Spin-up command - Trigger agent spin-up
 */

import { Command } from 'commander';
import ora from 'ora';
import type { SpinUpResult } from '@loom/shared';
import { loadConfig } from '../utils/config-file.js';
import { getNATSConnection, closeNATSConnection, CoordinatorSubjects } from '../nats/client.js';
import { output, success, error, info, formatKeyValue } from '../utils/output.js';
import { getGlobalOptions } from '../cli.js';

export function spinUpCommand(): Command {
  const cmd = new Command('spin-up');

  cmd
    .description('Trigger agent spin-up')
    .option('--target <name>', 'Target name to spin up')
    .option('--type <type>', 'Agent type filter (copilot-cli|claude-code)')
    .option('--capability <name>', 'Required capability')
    .option('--boundary <name>', 'Required boundary support')
    .action(async (options, command) => {
      const globalOpts = getGlobalOptions(command);
      const spinner = ora();

      try {
        const config = loadConfig(globalOpts.config);

        // Must provide either --target or filters
        if (!options.target && !options.type && !options.capability && !options.boundary) {
          error('Must provide either --target or at least one filter (--type, --capability, --boundary)', globalOpts);
          process.exit(1);
        }

        if (!globalOpts.quiet) {
          spinner.start('Triggering agent spin-up...');
        }

        const nc = await getNATSConnection(config);
        const subjects = new CoordinatorSubjects(config.projectId);

        let targetId: string;

        if (options.target) {
          // Spin up specific target
          targetId = options.target;
        } else {
          // Query for target based on filters
          const filter: any = {};
          if (options.type) filter.agentType = options.type;
          if (options.capability) filter.capability = options.capability;
          if (options.boundary) filter.boundary = options.boundary;

          const queryResponse = await nc.request(
            subjects.targetsList(),
            JSON.stringify(filter),
            { timeout: 5000 }
          );

          const targets = JSON.parse(new TextDecoder().decode(queryResponse.data));

          if (targets.length === 0) {
            error('No matching targets found', globalOpts);
            await closeNATSConnection();
            process.exit(1);
          }

          // Use first available target
          targetId = targets[0].id;
          info(`Selected target: ${targets[0].name}`, globalOpts);
        }

        // Trigger spin-up
        const response = await nc.request(
          subjects.spinUpTrigger(),
          JSON.stringify({ target: targetId }),
          { timeout: 30000 } // Longer timeout for spin-up
        );

        const result: SpinUpResult = JSON.parse(
          new TextDecoder().decode(response.data)
        );

        await closeNATSConnection();

        if (!globalOpts.quiet) {
          if (result.success) {
            spinner.succeed('Agent spin-up initiated');
          } else {
            spinner.fail('Spin-up failed');
          }
        }

        // Output results
        if (globalOpts.json) {
          output(result, globalOpts);
        } else {
          if (result.success) {
            success('Agent spin-up triggered successfully!', globalOpts);
            console.log();
            console.log(
              formatKeyValue({
                'Target ID': result.targetId,
                'Target Name': result.targetName,
                'Timestamp': new Date(result.timestamp).toLocaleString(),
              })
            );

            if (result.mechanismResult) {
              console.log('\nMechanism Details:');
              console.log(formatKeyValue(result.mechanismResult));
            }
          } else {
            error(`Spin-up failed: ${result.error}`, globalOpts);
            process.exit(1);
          }
        }
      } catch (err: any) {
        if (spinner.isSpinning) {
          spinner.fail('Failed to trigger spin-up');
        }
        error(`Error: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}
