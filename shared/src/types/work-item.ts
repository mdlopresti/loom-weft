/**
 * Workload boundary for routing decisions
 *
 * Boundaries are user-defined named isolation zones. Work is routed
 * only to agents that belong to the same boundary.
 *
 * Examples: "production", "staging", "team-alpha", "client-acme"
 */
export type Boundary = string;

/**
 * Agent types supported by the coordinator
 */
export type AgentType = 'copilot-cli' | 'claude-code';

/**
 * Work item status
 */
export type WorkItemStatus =
  | 'pending'     // Waiting for assignment
  | 'assigned'    // Assigned to a worker
  | 'in-progress' // Worker is actively working
  | 'completed'   // Successfully completed
  | 'failed'      // Failed after all retries
  | 'cancelled';  // Cancelled by user

/**
 * Priority levels (1-10, higher = more urgent)
 */
export type Priority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Base work item from nats-mcp-server
 */
export interface BaseWorkItem {
  id: string;
  taskId: string;
  capability: string;
  description: string;
  priority: Priority;
  offeredBy: string;
  offeredAt: string;
  attempts: number;
  deadline?: string;
  contextData?: Record<string, unknown>;
}

/**
 * Coordinated work item with boundary for routing
 */
export interface CoordinatedWorkItem extends BaseWorkItem {
  /** Boundary determines which agents can handle this work */
  boundary: Boundary;

  /** Preferred agent type (routing will try this first) */
  preferredAgentType?: AgentType;

  /** Required agent type (overrides routing rules) */
  requiredAgentType?: AgentType;

  /** Current status */
  status: WorkItemStatus;

  /** Assigned worker GUID */
  assignedTo?: string;

  /** When the work was assigned */
  assignedAt?: string;

  /** Progress percentage (0-100) */
  progress?: number;

  /** Completion result */
  result?: WorkItemResult;

  /** Error information if failed */
  error?: WorkItemError;
}

/**
 * Work item result on completion
 */
export interface WorkItemResult {
  /** Summary of what was done */
  summary?: string;

  /** Output data */
  output?: Record<string, unknown>;

  /** Files created or modified */
  artifacts?: string[];

  /** Completion timestamp */
  completedAt: string;
}

/**
 * Work item error information
 */
export interface WorkItemError {
  /** Error message */
  message: string;

  /** Error code if applicable */
  code?: string;

  /** Whether the error is recoverable */
  recoverable: boolean;

  /** Stack trace if available */
  stack?: string;

  /** When the error occurred */
  occurredAt: string;
}

/**
 * Request to submit new work
 */
export interface WorkSubmitRequest {
  /** Application-defined task ID */
  taskId: string;

  /** Workload boundary for routing */
  boundary: Boundary;

  /** Required capability (e.g., 'typescript', 'python') */
  capability: string;

  /** Human-readable task description */
  description: string;

  /** Priority 1-10 (default: 5) */
  priority?: Priority;

  /** Preferred agent type */
  preferredAgentType?: AgentType;

  /** Required agent type (overrides routing) */
  requiredAgentType?: AgentType;

  /** Optional deadline (ISO 8601) */
  deadline?: string;

  /** Additional context data */
  contextData?: Record<string, unknown>;
}

/**
 * Work submission response
 */
export interface WorkSubmitResponse {
  /** Generated work item ID */
  workItemId: string;

  /** Resolved agent type based on routing */
  targetAgentType: AgentType;

  /** Whether spin-up was triggered */
  spinUpTriggered: boolean;

  /** Estimated wait time in seconds */
  estimatedWaitSeconds?: number;
}
