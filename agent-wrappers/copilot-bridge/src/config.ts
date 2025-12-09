import type { Boundary } from '@loom/shared';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

/**
 * Bridge configuration
 */
export interface BridgeConfig {
  /** NATS server URL */
  natsUrl: string;

  /** Project ID for namespace isolation */
  projectId: string;

  /** Agent handle/identifier */
  agentHandle: string;

  /** Agent capabilities */
  capabilities: string[];

  /** Workload boundaries this agent can accept work from */
  boundaries: Boundary[];

  /** Idle timeout in ms (0 = never timeout) */
  idleTimeoutMs: number;

  /** Target name (if this agent represents a spin-up target) */
  targetName?: string;

  /** Whether to register target on startup */
  registerTarget: boolean;

  /** Max concurrent work items (default: 1) */
  maxConcurrent: number;

  /** Copilot CLI path (default: 'copilot' in PATH) */
  copilotPath: string;

  /** Working directory for copilot execution */
  workingDirectory: string;

  /** Additional environment variables for copilot */
  copilotEnv: Record<string, string>;

  /** Agent to use with Copilot (optional) */
  copilotAgent?: string;
}

/**
 * Default configuration values
 */
const DEFAULTS: Partial<BridgeConfig> = {
  agentHandle: `copilot-agent-${require('os').hostname()}`,
  capabilities: ['general'],
  boundaries: ['default'],
  idleTimeoutMs: 300000, // 5 minutes
  registerTarget: false,
  maxConcurrent: 1,
  copilotPath: 'copilot',
  workingDirectory: process.cwd(),
  copilotEnv: {},
};

/**
 * Load configuration from environment variables
 */
function loadFromEnv(): Partial<BridgeConfig> {
  const config: Partial<BridgeConfig> = {};

  if (process.env.NATS_URL) {
    config.natsUrl = process.env.NATS_URL;
  }

  if (process.env.LOOM_PROJECT_ID) {
    config.projectId = process.env.LOOM_PROJECT_ID;
  }

  if (process.env.AGENT_HANDLE) {
    config.agentHandle = process.env.AGENT_HANDLE;
  }

  if (process.env.AGENT_CAPABILITIES) {
    config.capabilities = process.env.AGENT_CAPABILITIES.split(',').map(s => s.trim());
  }

  if (process.env.AGENT_CLASSIFICATIONS) {
    config.boundaries = process.env.AGENT_CLASSIFICATIONS.split(',').map(s => s.trim()) as Boundary[];
  }

  if (process.env.IDLE_TIMEOUT_MS) {
    config.idleTimeoutMs = parseInt(process.env.IDLE_TIMEOUT_MS, 10);
  }

  if (process.env.TARGET_NAME) {
    config.targetName = process.env.TARGET_NAME;
  }

  if (process.env.REGISTER_TARGET) {
    config.registerTarget = process.env.REGISTER_TARGET.toLowerCase() === 'true';
  }

  if (process.env.MAX_CONCURRENT) {
    config.maxConcurrent = parseInt(process.env.MAX_CONCURRENT, 10);
  }

  if (process.env.COPILOT_PATH) {
    config.copilotPath = process.env.COPILOT_PATH;
  }

  if (process.env.WORK_DIR) {
    config.workingDirectory = process.env.WORK_DIR;
  }

  if (process.env.COPILOT_AGENT) {
    config.copilotAgent = process.env.COPILOT_AGENT;
  }

  // Load additional environment variables for copilot
  const copilotEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('COPILOT_ENV_')) {
      const envKey = key.substring('COPILOT_ENV_'.length);
      copilotEnv[envKey] = value!;
    }
  }
  if (Object.keys(copilotEnv).length > 0) {
    config.copilotEnv = copilotEnv;
  }

  return config;
}

/**
 * Load configuration from file
 */
function loadFromFile(configPath?: string): Partial<BridgeConfig> {
  // Try config file path from env, then default locations
  const paths = [
    configPath,
    process.env.COPILOT_BRIDGE_CONFIG,
    resolve(process.cwd(), 'copilot-bridge.json'),
    resolve(homedir(), '.config', 'copilot-bridge', 'config.json'),
  ].filter(Boolean) as string[];

  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        console.warn(`Failed to load config from ${path}:`, error);
      }
    }
  }

  return {};
}

/**
 * Validate configuration
 */
function validateConfig(config: Partial<BridgeConfig>): asserts config is BridgeConfig {
  const errors: string[] = [];

  if (!config.natsUrl) {
    errors.push('NATS_URL is required');
  }

  if (!config.projectId) {
    errors.push('LOOM_PROJECT_ID is required');
  }

  if (!config.agentHandle) {
    errors.push('AGENT_HANDLE is required');
  }

  if (!config.capabilities || config.capabilities.length === 0) {
    errors.push('At least one capability is required');
  }

  if (!config.boundaries || config.boundaries.length === 0) {
    errors.push('At least one boundary is required');
  }

  if (config.registerTarget && !config.targetName) {
    errors.push('TARGET_NAME is required when REGISTER_TARGET is true');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  ${errors.join('\n  ')}`);
  }
}

/**
 * Load and merge configuration from all sources
 */
export function loadConfig(configPath?: string): BridgeConfig {
  // Merge in order: defaults -> file -> env
  const config: Partial<BridgeConfig> = {
    ...DEFAULTS,
    ...loadFromFile(configPath),
    ...loadFromEnv(),
  };

  validateConfig(config);

  return config;
}

/**
 * Print configuration (with sensitive values redacted)
 */
export function printConfig(config: BridgeConfig): void {
  console.log('=== Copilot Bridge Configuration ===');
  console.log(`  NATS URL: ${config.natsUrl}`);
  console.log(`  Project ID: ${config.projectId}`);
  console.log(`  Agent Handle: ${config.agentHandle}`);
  console.log(`  Capabilities: ${config.capabilities.join(', ')}`);
  console.log(`  Boundaries: ${config.boundaries.join(', ')}`);
  console.log(`  Idle Timeout: ${config.idleTimeoutMs}ms`);
  console.log(`  Max Concurrent: ${config.maxConcurrent}`);
  console.log(`  Copilot Path: ${config.copilotPath}`);
  console.log(`  Working Directory: ${config.workingDirectory}`);
  console.log(`  Target Name: ${config.targetName || '<none>'}`);
  console.log(`  Register Target: ${config.registerTarget}`);
  if (config.copilotAgent) {
    console.log(`  Copilot Agent: ${config.copilotAgent}`);
  }
  console.log('====================================');
}
