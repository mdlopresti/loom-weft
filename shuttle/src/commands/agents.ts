/**
 * Agents command - List and manage agents
 */

import { Command } from 'commander';
import ora from 'ora';
import type { RegisteredAgent } from '@loom/shared';
import { loadConfig } from '../utils/config-file.js';
import { getNATSConnection, closeNATSConnection, CoordinatorSubjects } from '../nats/client.js';
import {
  output,
  error,
  createTable,
  colorStatus,
  colorAgentType,
  formatTimestamp,
  truncate,
} from '../utils/output.js';
import { getGlobalOptions } from '../cli.js';

export function agentsCommand(): Command {
  const cmd = new Command('agents');

  cmd
    .description('List registered agents')
    .option('--type <type>', 'Filter by agent type (copilot-cli|claude-code)')
    .option('--status <status>', 'Filter by status (online|busy|offline)')
    .option('--capability <name>', 'Filter by capability')
    .action(async (options, command) => {
      const globalOpts = getGlobalOptions(command);
      const spinner = ora();

      try {
        const config = loadConfig(globalOpts.config);

        if (!globalOpts.quiet) {
          spinner.start('Fetching agents...');
        }

        const nc = await getNATSConnection(config);
        const subjects = new CoordinatorSubjects(config.projectId);

        // Build filter
        const filter: any = {};
        if (options.type) filter.agentType = options.type;
        if (options.status) filter.status = options.status;
        if (options.capability) filter.capability = options.capability;

        const response = await nc.request(
          subjects.agentsList(),
          JSON.stringify(filter),
          { timeout: 5000 }
        );

        const agents: RegisteredAgent[] = JSON.parse(
          new TextDecoder().decode(response.data)
        );

        await closeNATSConnection();

        if (!globalOpts.quiet) {
          spinner.succeed(`Found ${agents.length} agent(s)`);
        }

        // Output results
        if (globalOpts.json) {
          output(agents, globalOpts);
        } else {
          if (agents.length === 0) {
            console.log('No agents found');
            return;
          }

          const table = createTable(
            ['GUID', 'Type', 'Status', 'Capabilities', 'Tasks', 'Last Activity'],
            agents.map((agent) => [
              truncate(agent.guid, 12),
              colorAgentType(agent.agentType),
              colorStatus(agent.status),
              truncate(agent.capabilities.join(', '), 30),
              `${agent.currentTaskCount}/${agent.maxConcurrentTasks}`,
              formatTimestamp(agent.lastActivity),
            ])
          );

          console.log(table.toString());
        }
      } catch (err: any) {
        if (spinner.isSpinning) {
          spinner.fail('Failed to fetch agents');
        }
        error(`Error: ${err.message}`, {});
        process.exit(1);
      }
    });

  return cmd;
}
