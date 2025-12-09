import type { AgentType, Boundary } from './work-item.js';

/**
 * Agent status
 */
export type AgentStatus = 'online' | 'busy' | 'offline';

/**
 * Agent visibility for discovery
 */
export type AgentVisibility = 'private' | 'project-only' | 'user-only' | 'public';

/**
 * Registered agent information
 */
export interface RegisteredAgent {
  /** Unique agent identifier (UUID) */
  guid: string;

  /** Agent handle/username */
  handle: string;

  /** Agent type (copilot-cli or claude-code) */
  agentType: AgentType;

  /** Current status */
  status: AgentStatus;

  /** List of capabilities */
  capabilities: string[];

  /** Workload boundaries this agent can accept work from */
  boundaries: Boundary[];

  /** Hostname where agent is running */
  hostname: string;

  /** Project ID the agent is associated with */
  projectId: string;

  /** Username (for user-level visibility) */
  username?: string;

  /** Visibility setting */
  visibility: AgentVisibility;

  /** Number of tasks currently being worked on */
  currentTaskCount: number;

  /** Maximum concurrent tasks */
  maxConcurrentTasks: number;

  /** Idle timeout in ms (0 = never shutdown) */
  spindownAfterIdleMs: number;

  /** Last heartbeat timestamp */
  lastHeartbeat: string;

  /** Last activity timestamp */
  lastActivity: string;

  /** Registration timestamp */
  registeredAt: string;
}

/**
 * Agent registration request
 */
export interface AgentRegisterRequest {
  /** Agent type */
  agentType: AgentType;

  /** Agent handle */
  handle: string;

  /** Capabilities list */
  capabilities: string[];

  /** Workload boundaries this agent can accept work from */
  boundaries: Boundary[];

  /** Hostname */
  hostname: string;

  /** Visibility setting */
  visibility?: AgentVisibility;

  /** Max concurrent tasks (default: 1) */
  maxConcurrentTasks?: number;

  /** Idle timeout in ms (default: 300000 = 5 min) */
  spindownAfterIdleMs?: number;
}

/**
 * Agent heartbeat message
 */
export interface AgentHeartbeat {
  /** Agent GUID */
  guid: string;

  /** Current status */
  status: AgentStatus;

  /** Current task count */
  currentTaskCount: number;

  /** Timestamp */
  timestamp: string;
}

/**
 * Agent shutdown request
 */
export interface AgentShutdownRequest {
  /** Agent GUID to shutdown */
  guid: string;

  /** Reason for shutdown */
  reason: 'idle-timeout' | 'manual' | 'coordinator-shutdown' | 'error';

  /** Whether to wait for current work to complete */
  graceful: boolean;

  /** Grace period in ms (default: 30000) */
  gracePeriodMs?: number;
}

/**
 * Query filters for discovering agents
 */
export interface AgentDiscoveryFilter {
  /** Filter by agent type */
  agentType?: AgentType;

  /** Filter by capability */
  capability?: string;

  /** Filter by status */
  status?: AgentStatus;

  /** Filter by boundary they accept */
  acceptsBoundary?: Boundary;

  /** Include offline agents */
  includeOffline?: boolean;

  /** Filter by hostname */
  hostname?: string;
}
