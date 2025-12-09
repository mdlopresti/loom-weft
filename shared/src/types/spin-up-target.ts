import type { AgentType, Boundary } from './work-item.js';

/**
 * Spin-up mechanism types
 */
export type SpinUpMechanism = 'ssh' | 'github-actions' | 'local' | 'webhook' | 'kubernetes';

/**
 * Target status
 */
export type TargetStatus = 'available' | 'in-use' | 'disabled' | 'error';

/**
 * Health status from last check
 */
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

/**
 * SSH mechanism configuration
 */
export interface SSHMechanismConfig {
  /** SSH host */
  host: string;

  /** SSH port (default: 22) */
  port?: number;

  /** SSH username */
  user: string;

  /** Path to private key (optional, uses ssh-agent if not specified) */
  privateKeyPath?: string;

  /** Command to execute on the remote host */
  command: string;

  /** Working directory on remote host */
  workingDirectory?: string;

  /** Environment variables to set */
  env?: Record<string, string>;

  /** Connection timeout in ms (default: 30000) */
  connectionTimeoutMs?: number;
}

/**
 * GitHub Actions mechanism configuration
 */
export interface GitHubActionsMechanismConfig {
  /** Repository in owner/repo format */
  repo: string;

  /** Workflow file name */
  workflow: string;

  /** Git ref to run the workflow on (default: main) */
  ref?: string;

  /** GitHub token environment variable name (default: GITHUB_TOKEN) */
  tokenEnvVar?: string;

  /** Additional workflow inputs */
  inputs?: Record<string, string>;

  /** Timeout waiting for workflow to start (ms) */
  startTimeoutMs?: number;
}

/**
 * Local process mechanism configuration
 */
export interface LocalMechanismConfig {
  /** Command to execute */
  command: string;

  /** Command arguments */
  args?: string[];

  /** Working directory */
  workingDirectory?: string;

  /** Environment variables */
  env?: Record<string, string>;

  /** Whether to detach the process (default: true) */
  detached?: boolean;
}

/**
 * Webhook mechanism configuration
 */
export interface WebhookMechanismConfig {
  /** Webhook URL to call */
  url: string;

  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT';

  /** Headers to include */
  headers?: Record<string, string>;

  /** Request body template (JSON string with {{workItemId}} etc placeholders) */
  bodyTemplate?: string;

  /** Expected success status codes (default: [200, 201, 202]) */
  successCodes?: number[];

  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
}

/**
 * Kubernetes mechanism configuration
 */
export interface KubernetesMechanismConfig {
  /** Kubernetes namespace */
  namespace: string;

  /** Job name prefix */
  jobNamePrefix: string;

  /** Container image */
  image: string;

  /** Image pull secret name */
  imagePullSecret?: string;

  /** Service account name */
  serviceAccount?: string;

  /** Command override */
  command?: string[];

  /** Args override */
  args?: string[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Resource requests */
  resources?: {
    cpu?: string;
    memory?: string;
  };

  /** TTL after finished (seconds) */
  ttlSecondsAfterFinished?: number;
}

/**
 * Union type for mechanism configs
 */
export type MechanismConfig =
  | { mechanism: 'ssh'; ssh: SSHMechanismConfig }
  | { mechanism: 'github-actions'; githubActions: GitHubActionsMechanismConfig }
  | { mechanism: 'local'; local: LocalMechanismConfig }
  | { mechanism: 'webhook'; webhook: WebhookMechanismConfig }
  | { mechanism: 'kubernetes'; kubernetes: KubernetesMechanismConfig };

/**
 * Spin-up target - a registered way to start an agent
 */
export interface SpinUpTarget {
  /** Unique identifier (UUID) */
  id: string;

  /** Human-readable name (e.g., "home-claude", "work-copilot") */
  name: string;

  /** Description of this target */
  description?: string;

  /** Agent type this target produces */
  agentType: AgentType;

  /** Capabilities the spawned agent will have */
  capabilities: string[];

  /** Workload boundaries this target can handle */
  boundaries: Boundary[];

  /** How to spin up the agent */
  mechanism: SpinUpMechanism;

  /** Mechanism-specific configuration */
  config: MechanismConfig;

  /** Current status */
  status: TargetStatus;

  /** If an agent from this target is currently running, its GUID */
  currentAgentGuid?: string;

  /** Health check configuration */
  healthCheck?: {
    /** Whether health checks are enabled */
    enabled: boolean;
    /** Interval between checks (ms) */
    intervalMs: number;
    /** Timeout for health check (ms) */
    timeoutMs: number;
  };

  /** Last health check timestamp */
  lastHealthCheck?: string;

  /** Health status from last check */
  healthStatus: HealthStatus;

  /** Last error message if status is 'error' */
  lastError?: string;

  /** How this target was registered */
  registeredBy: 'cli' | 'api' | 'agent' | 'config';

  /** If registered by agent, the agent's GUID */
  registeredByAgentGuid?: string;

  /** Registration timestamp */
  registeredAt: string;

  /** Last update timestamp */
  updatedAt: string;

  /** Last time this target was used to spin up an agent */
  lastUsedAt?: string;

  /** Number of times this target has been used */
  useCount: number;

  /** Tags for organization */
  tags?: string[];
}

/**
 * Request to register a new spin-up target
 */
export interface TargetRegisterRequest {
  /** Human-readable name (must be unique) */
  name: string;

  /** Description */
  description?: string;

  /** Agent type */
  agentType: AgentType;

  /** Capabilities */
  capabilities: string[];

  /** Workload boundaries this target can handle */
  boundaries?: Boundary[];

  /** Mechanism type */
  mechanism: SpinUpMechanism;

  /** Mechanism configuration */
  config: MechanismConfig;

  /** Health check settings */
  healthCheck?: {
    enabled: boolean;
    intervalMs?: number;
    timeoutMs?: number;
  };

  /** Tags */
  tags?: string[];
}

/**
 * Request to update an existing target
 */
export interface TargetUpdateRequest {
  /** Target ID or name */
  target: string;

  /** Fields to update */
  updates: {
    description?: string;
    capabilities?: string[];
    boundaries?: Boundary[];
    config?: Partial<MechanismConfig>;
    healthCheck?: {
      enabled?: boolean;
      intervalMs?: number;
      timeoutMs?: number;
    };
    tags?: string[];
  };
}

/**
 * Query filters for finding targets
 */
export interface TargetQueryFilter {
  /** Filter by agent type */
  agentType?: AgentType;

  /** Filter by capability (target must have this capability) */
  capability?: string;

  /** Filter by boundary (target must include this boundary) */
  boundary?: Boundary;

  /** Filter by status */
  status?: TargetStatus;

  /** Filter by health status */
  healthStatus?: HealthStatus;

  /** Filter by mechanism type */
  mechanism?: SpinUpMechanism;

  /** Filter by tag */
  tag?: string;

  /** Include disabled targets (default: false) */
  includeDisabled?: boolean;
}

/**
 * Result of a spin-up attempt
 */
export interface SpinUpResult {
  /** Whether spin-up was initiated successfully */
  success: boolean;

  /** Target that was used */
  targetId: string;

  /** Target name */
  targetName: string;

  /** Error message if failed */
  error?: string;

  /** Mechanism-specific result data */
  mechanismResult?: {
    /** For SSH: the remote process ID */
    pid?: number;
    /** For GitHub Actions: the workflow run ID */
    runId?: number;
    /** For Kubernetes: the job name */
    jobName?: string;
    /** For Webhook: the response body */
    response?: unknown;
  };

  /** Timestamp */
  timestamp: string;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Target ID */
  targetId: string;

  /** Whether the check passed */
  healthy: boolean;

  /** Error message if unhealthy */
  error?: string;

  /** Response time in ms */
  responseTimeMs?: number;

  /** Timestamp */
  timestamp: string;
}
