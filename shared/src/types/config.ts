import type { BoundaryConfig } from './routing.js';

/**
 * NATS connection configuration
 */
export interface NATSConfiguration {
  /** NATS server URL */
  url: string;

  /** Path to credentials file */
  credentials?: string;

  /** Connection name */
  name?: string;

  /** Reconnect options */
  reconnect?: {
    maxAttempts: number;
    delayMs: number;
    maxDelayMs: number;
  };
}

/**
 * REST API configuration
 */
export interface APIConfiguration {
  /** Whether API is enabled */
  enabled: boolean;

  /** Port to listen on */
  port: number;

  /** Host to bind to */
  host: string;

  /** Bearer tokens for authentication (empty = no auth) */
  authTokens?: string[];

  /** CORS origins */
  corsOrigins?: string[];
}

/**
 * Idle detection configuration
 */
export interface IdleConfiguration {
  /** Default idle timeout in ms */
  defaultTimeoutMs: number;

  /** How often to check for idle agents (ms) */
  checkIntervalMs: number;

  /** Grace period before shutdown (ms) */
  gracePeriodMs: number;
}

/**
 * Spin-up behavior configuration
 * Note: Actual targets are stored in the dynamic KV registry, not here
 */
export interface SpinUpBehaviorConfiguration {
  /** Whether automatic spin-up is enabled */
  enabled: boolean;

  /** Default timeout for spin-up operations (ms) */
  defaultTimeoutMs: number;

  /** Maximum concurrent spin-ups */
  maxConcurrent: number;

  /** Cooldown between spin-up attempts for the same target (ms) */
  cooldownMs: number;

  /** Health check configuration */
  healthCheck: {
    /** Whether to perform health checks on targets */
    enabled: boolean;
    /** Default interval between checks (ms) */
    intervalMs: number;
    /** Default timeout for health checks (ms) */
    timeoutMs: number;
  };
}

/**
 * Full coordinator configuration
 * Note: Spin-up targets are NOT in config - they're in the KV registry
 */
export interface CoordinatorConfiguration {
  /** NATS connection settings */
  nats: NATSConfiguration;

  /** Project ID for namespace isolation */
  projectId: string;

  /** Boundary-specific configuration (optional) */
  boundaryConfigs?: BoundaryConfig[];

  /** Spin-up behavior settings */
  spinUp: SpinUpBehaviorConfiguration;

  /** REST API configuration */
  api: APIConfiguration;

  /** Idle detection configuration */
  idle: IdleConfiguration;

  /** Logging level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Default coordinator configuration
 */
export const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfiguration = {
  nats: {
    url: 'nats://localhost:4222',
    name: 'coordinator',
    reconnect: {
      maxAttempts: 10,
      delayMs: 1000,
      maxDelayMs: 30000,
    },
  },
  projectId: 'default',
  spinUp: {
    enabled: true,
    defaultTimeoutMs: 60000,
    maxConcurrent: 3,
    cooldownMs: 30000,
    healthCheck: {
      enabled: true,
      intervalMs: 300000, // 5 minutes
      timeoutMs: 30000,
    },
  },
  api: {
    enabled: true,
    port: 3000,
    host: '0.0.0.0',
  },
  idle: {
    defaultTimeoutMs: 300000, // 5 minutes
    checkIntervalMs: 60000, // 1 minute
    gracePeriodMs: 30000, // 30 seconds
  },
  logLevel: 'info',
};

/**
 * CLI configuration (persisted to file)
 */
export interface CLIConfiguration {
  /** NATS URL */
  natsUrl: string;

  /** Project ID */
  projectId: string;

  /** Default boundary for work submissions */
  defaultBoundary?: string;

  /** Default priority */
  defaultPriority?: number;

  /** Output format preference */
  outputFormat?: 'table' | 'json';

  /** Coordinator API URL (if using REST instead of NATS) */
  apiUrl?: string;

  /** API auth token */
  apiToken?: string;
}

/**
 * Default CLI configuration
 */
export const DEFAULT_CLI_CONFIG: Partial<CLIConfiguration> = {
  natsUrl: 'nats://localhost:4222',
  defaultPriority: 5,
  outputFormat: 'table',
};
