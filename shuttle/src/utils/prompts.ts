/**
 * Interactive prompts using inquirer
 */

import inquirer from 'inquirer';
import type {
  Boundary,
  SpinUpMechanism,
  Priority,
} from '@loom/shared';

/**
 * Prompt for work boundary
 *
 * Boundaries are user-defined named isolation zones.
 * Examples: production, staging, team-alpha, client-acme
 */
export async function promptBoundary(): Promise<Boundary> {
  const { boundary } = await inquirer.prompt([
    {
      type: 'input',
      name: 'boundary',
      message: 'Work boundary (e.g., production, staging, team-alpha):',
      default: 'default',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Boundary is required';
        }
        return true;
      },
    },
  ]);
  return boundary;
}

/**
 * Prompt for work submission details
 */
export async function promptWorkSubmission(
  defaults?: Partial<{
    boundary: Boundary;
    capability: string;
    priority: Priority;
    description: string;
  }>
) {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'boundary',
      message: 'Work boundary (e.g., production, staging, team-alpha):',
      default: defaults?.boundary || 'default',
      when: !defaults?.boundary,
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Boundary is required';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'capability',
      message: 'Required capability (e.g., typescript, python):',
      default: defaults?.capability || 'general',
      when: !defaults?.capability,
    },
    {
      type: 'input',
      name: 'description',
      message: 'Task description:',
      default: defaults?.description,
      when: !defaults?.description,
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Description is required';
        }
        return true;
      },
    },
    {
      type: 'number',
      name: 'priority',
      message: 'Priority (1-10):',
      default: defaults?.priority || 5,
      when: defaults?.priority === undefined,
      validate: (input: number) => {
        if (input < 1 || input > 10) {
          return 'Priority must be between 1 and 10';
        }
        return true;
      },
    },
  ]);

  return {
    boundary: defaults?.boundary || answers.boundary,
    capability: defaults?.capability || answers.capability,
    description: defaults?.description || answers.description,
    priority: (defaults?.priority || answers.priority) as Priority,
  };
}

/**
 * Prompt for target registration
 */
export async function promptTargetRegistration() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Target name (unique identifier):',
      validate: (input: string) => {
        if (!input || !/^[a-z0-9-]+$/.test(input)) {
          return 'Name must contain only lowercase letters, numbers, and hyphens';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description (optional):',
    },
    {
      type: 'list',
      name: 'agentType',
      message: 'Agent type:',
      choices: [
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Copilot CLI', value: 'copilot-cli' },
      ],
    },
    {
      type: 'input',
      name: 'capabilities',
      message: 'Capabilities (comma-separated):',
      default: 'general',
      filter: (input: string) => input.split(',').map((s) => s.trim()),
    },
    {
      type: 'input',
      name: 'boundaries',
      message: 'Allowed work boundaries (comma-separated, e.g., production,staging):',
      default: 'default',
      filter: (input: string) => input.split(',').map((s) => s.trim()).filter(s => s.length > 0),
      validate: (input: string) => {
        const boundaries = input.split(',').map((s) => s.trim()).filter(s => s.length > 0);
        if (boundaries.length === 0) {
          return 'At least one boundary is required';
        }
        return true;
      },
    },
    {
      type: 'list',
      name: 'mechanism',
      message: 'Spin-up mechanism:',
      choices: [
        { name: 'SSH', value: 'ssh' },
        { name: 'Local Process', value: 'local' },
        { name: 'GitHub Actions', value: 'github-actions' },
        { name: 'Webhook', value: 'webhook' },
        { name: 'Kubernetes', value: 'kubernetes' },
      ],
    },
  ]);

  // Prompt for mechanism-specific config
  let mechanismConfig;
  switch (answers.mechanism as SpinUpMechanism) {
    case 'ssh':
      mechanismConfig = await promptSSHConfig();
      break;
    case 'local':
      mechanismConfig = await promptLocalConfig();
      break;
    case 'github-actions':
      mechanismConfig = await promptGitHubActionsConfig();
      break;
    case 'webhook':
      mechanismConfig = await promptWebhookConfig();
      break;
    case 'kubernetes':
      mechanismConfig = await promptKubernetesConfig();
      break;
  }

  return {
    ...answers,
    config: mechanismConfig,
  };
}

async function promptSSHConfig() {
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: 'SSH host:',
      validate: (input: string) => (input ? true : 'Host is required'),
    },
    {
      type: 'input',
      name: 'user',
      message: 'SSH username:',
      validate: (input: string) => (input ? true : 'Username is required'),
    },
    {
      type: 'number',
      name: 'port',
      message: 'SSH port:',
      default: 22,
    },
    {
      type: 'input',
      name: 'command',
      message: 'Command to execute:',
      default: './bootstrap.sh',
      validate: (input: string) => (input ? true : 'Command is required'),
    },
    {
      type: 'input',
      name: 'workingDirectory',
      message: 'Working directory (optional):',
    },
  ]);

  return {
    mechanism: 'ssh' as const,
    ssh: config,
  };
}

async function promptLocalConfig() {
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'command',
      message: 'Command to execute:',
      validate: (input: string) => (input ? true : 'Command is required'),
    },
    {
      type: 'input',
      name: 'args',
      message: 'Arguments (space-separated, optional):',
      filter: (input: string) => (input ? input.split(' ') : []),
    },
    {
      type: 'input',
      name: 'workingDirectory',
      message: 'Working directory (optional):',
    },
  ]);

  return {
    mechanism: 'local' as const,
    local: config,
  };
}

async function promptGitHubActionsConfig() {
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'repo',
      message: 'Repository (owner/repo):',
      validate: (input: string) => {
        if (!input || !input.includes('/')) {
          return 'Repository must be in format owner/repo';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'workflow',
      message: 'Workflow file name:',
      default: 'agent-spin-up.yml',
      validate: (input: string) => (input ? true : 'Workflow name is required'),
    },
    {
      type: 'input',
      name: 'ref',
      message: 'Git ref:',
      default: 'main',
    },
  ]);

  return {
    mechanism: 'github-actions' as const,
    githubActions: config,
  };
}

async function promptWebhookConfig() {
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Webhook URL:',
      validate: (input: string) => {
        if (!input || !input.startsWith('http')) {
          return 'URL must start with http:// or https://';
        }
        return true;
      },
    },
    {
      type: 'list',
      name: 'method',
      message: 'HTTP method:',
      choices: ['POST', 'GET', 'PUT'],
      default: 'POST',
    },
  ]);

  return {
    mechanism: 'webhook' as const,
    webhook: config,
  };
}

async function promptKubernetesConfig() {
  const config = await inquirer.prompt([
    {
      type: 'input',
      name: 'namespace',
      message: 'Kubernetes namespace:',
      default: 'default',
      validate: (input: string) => (input ? true : 'Namespace is required'),
    },
    {
      type: 'input',
      name: 'image',
      message: 'Container image:',
      validate: (input: string) => (input ? true : 'Image is required'),
    },
    {
      type: 'input',
      name: 'jobNamePrefix',
      message: 'Job name prefix:',
      default: 'agent',
      validate: (input: string) => (input ? true : 'Job name prefix is required'),
    },
  ]);

  return {
    mechanism: 'kubernetes' as const,
    kubernetes: config,
  };
}

/**
 * Confirm an action
 */
export async function confirm(message: string, defaultValue = false): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: defaultValue,
    },
  ]);
  return confirmed;
}
