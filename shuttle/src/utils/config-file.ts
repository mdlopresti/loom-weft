/**
 * Configuration file management
 * Stores user preferences in ~/.loom/config.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CLIConfiguration } from '@loom/shared';
import { DEFAULT_CLI_CONFIG } from '@loom/shared';

const CONFIG_DIR = join(homedir(), '.loom');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load configuration from file and environment variables
 * Environment variables take precedence over file config
 */
export function loadConfig(configPath?: string): CLIConfiguration {
  const filePath = configPath || CONFIG_FILE;

  let fileConfig: Partial<CLIConfiguration> = {};

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      fileConfig = JSON.parse(content);
    } catch (error) {
      console.warn(`Warning: Failed to parse config file: ${error}`);
    }
  }

  // Merge with defaults and environment variables
  const config: CLIConfiguration = {
    natsUrl: process.env.NATS_URL || fileConfig.natsUrl || DEFAULT_CLI_CONFIG.natsUrl!,
    projectId: process.env.PROJECT_ID || fileConfig.projectId || 'default',
    defaultBoundary: fileConfig.defaultBoundary,
    defaultPriority: fileConfig.defaultPriority || DEFAULT_CLI_CONFIG.defaultPriority,
    outputFormat: fileConfig.outputFormat || DEFAULT_CLI_CONFIG.outputFormat,
    apiUrl: process.env.LOOM_API_URL || fileConfig.apiUrl,
    apiToken: process.env.LOOM_API_TOKEN || fileConfig.apiToken,
  };

  return config;
}

/**
 * Save configuration to file
 */
export function saveConfig(config: Partial<CLIConfiguration>, configPath?: string): void {
  ensureConfigDir();

  const filePath = configPath || CONFIG_FILE;

  // Load existing config to merge with updates
  let existingConfig: Partial<CLIConfiguration> = {};
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      existingConfig = JSON.parse(content);
    } catch (error) {
      // Ignore parse errors, will overwrite
    }
  }

  const mergedConfig = {
    ...existingConfig,
    ...config,
  };

  writeFileSync(filePath, JSON.stringify(mergedConfig, null, 2), 'utf-8');
}

/**
 * Get a specific config value
 */
export function getConfigValue(key: keyof CLIConfiguration, configPath?: string): any {
  const config = loadConfig(configPath);
  return config[key];
}

/**
 * Set a specific config value
 */
export function setConfigValue(
  key: keyof CLIConfiguration,
  value: any,
  configPath?: string
): void {
  saveConfig({ [key]: value }, configPath);
}

/**
 * List all config values
 */
export function listConfig(configPath?: string): CLIConfiguration {
  return loadConfig(configPath);
}

/**
 * Validate configuration
 */
export function validateConfig(config: Partial<CLIConfiguration>): string[] {
  const errors: string[] = [];

  if (config.natsUrl && !config.natsUrl.startsWith('nats://')) {
    errors.push('natsUrl must start with nats://');
  }

  if (config.defaultPriority && (config.defaultPriority < 1 || config.defaultPriority > 10)) {
    errors.push('defaultPriority must be between 1 and 10');
  }

  if (
    config.defaultBoundary &&
    !['corporate', 'corporate-adjacent', 'personal', 'open-source'].includes(
      config.defaultBoundary
    )
  ) {
    errors.push(
      'defaultBoundary must be one of: corporate, corporate-adjacent, personal, open-source'
    );
  }

  if (config.outputFormat && !['table', 'json'].includes(config.outputFormat)) {
    errors.push('outputFormat must be either "table" or "json"');
  }

  return errors;
}

/**
 * Get default config file path
 */
export function getDefaultConfigPath(): string {
  return CONFIG_FILE;
}
