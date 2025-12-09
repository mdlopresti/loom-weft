/**
 * Idle tracker
 *
 * Tracks agent activity and emits shutdown signals when agents are idle
 */

import { EventEmitter } from 'events';

export interface IdleTrackerConfig {
  /** Idle timeout in milliseconds (default: 300000 = 5 minutes) */
  idleTimeoutMs?: number;

  /** How often to check for idle agents in milliseconds (default: 60000 = 1 minute) */
  checkIntervalMs?: number;
}

export interface IdleEvent {
  /** Agent GUID that became idle */
  agentGuid: string;

  /** Last activity timestamp */
  lastActivity: string;

  /** How long the agent has been idle (ms) */
  idleDurationMs: number;

  /** Timestamp when idle was detected */
  detectedAt: string;
}

interface AgentActivity {
  agentGuid: string;
  lastActivity: Date;
  currentTaskCount: number;
}

/**
 * Idle tracker for monitoring agent activity
 *
 * Events:
 * - 'idle': Emitted when an agent becomes idle (IdleEvent)
 * - 'shutdown-signal': Emitted when an idle agent should be shut down (agentGuid: string)
 */
export class IdleTracker extends EventEmitter {
  private config: Required<IdleTrackerConfig>;
  private activities: Map<string, AgentActivity> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(config?: IdleTrackerConfig) {
    super();
    this.config = {
      idleTimeoutMs: config?.idleTimeoutMs ?? 300000, // 5 minutes
      checkIntervalMs: config?.checkIntervalMs ?? 60000, // 1 minute
    };
  }

  /**
   * Start tracking idle agents
   */
  start(): void {
    if (this.checkInterval) {
      return; // Already started
    }

    this.checkInterval = setInterval(() => {
      this.checkForIdleAgents();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop tracking idle agents
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Record activity for an agent
   *
   * @param agentGuid Agent identifier
   * @param currentTaskCount Current number of tasks (0 = idle)
   */
  recordActivity(agentGuid: string, currentTaskCount: number): void {
    const now = new Date();

    this.activities.set(agentGuid, {
      agentGuid,
      lastActivity: now,
      currentTaskCount,
    });
  }

  /**
   * Remove an agent from tracking (e.g., on shutdown)
   */
  removeAgent(agentGuid: string): void {
    this.activities.delete(agentGuid);
  }

  /**
   * Get last activity time for an agent
   */
  getLastActivity(agentGuid: string): Date | null {
    return this.activities.get(agentGuid)?.lastActivity ?? null;
  }

  /**
   * Get idle duration for an agent in milliseconds
   */
  getIdleDuration(agentGuid: string): number | null {
    const activity = this.activities.get(agentGuid);
    if (!activity) {
      return null;
    }

    return Date.now() - activity.lastActivity.getTime();
  }

  /**
   * Check if an agent is currently idle
   */
  isIdle(agentGuid: string): boolean {
    const activity = this.activities.get(agentGuid);
    if (!activity) {
      return false;
    }

    // Agent is idle if it has no tasks and hasn't been active recently
    const idleDuration = Date.now() - activity.lastActivity.getTime();
    return activity.currentTaskCount === 0 && idleDuration >= this.config.idleTimeoutMs;
  }

  /**
   * Get all tracked agents
   */
  getTrackedAgents(): string[] {
    return Array.from(this.activities.keys());
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalAgents: number;
    idleAgents: number;
    activeAgents: number;
  } {
    const agents = Array.from(this.activities.values());
    const idleAgents = agents.filter(a => {
      const idleDuration = Date.now() - a.lastActivity.getTime();
      return a.currentTaskCount === 0 && idleDuration >= this.config.idleTimeoutMs;
    });

    return {
      totalAgents: agents.length,
      idleAgents: idleAgents.length,
      activeAgents: agents.length - idleAgents.length,
    };
  }

  /**
   * Check for idle agents and emit events
   */
  private checkForIdleAgents(): void {
    const now = new Date();

    for (const activity of this.activities.values()) {
      // Skip agents with active tasks
      if (activity.currentTaskCount > 0) {
        continue;
      }

      const idleDuration = now.getTime() - activity.lastActivity.getTime();

      // Check if agent has exceeded idle timeout
      if (idleDuration >= this.config.idleTimeoutMs) {
        const idleEvent: IdleEvent = {
          agentGuid: activity.agentGuid,
          lastActivity: activity.lastActivity.toISOString(),
          idleDurationMs: idleDuration,
          detectedAt: now.toISOString(),
        };

        // Emit idle event
        this.emit('idle', idleEvent);

        // Emit shutdown signal
        this.emit('shutdown-signal', activity.agentGuid);

        // Remove from tracking (agent will be shut down)
        this.activities.delete(activity.agentGuid);
      }
    }
  }

  /**
   * Clean up resources
   */
  shutdown(): void {
    this.stop();
    this.activities.clear();
    this.removeAllListeners();
  }
}

/**
 * Create an idle tracker instance
 */
export function createIdleTracker(config?: IdleTrackerConfig): IdleTracker {
  return new IdleTracker(config);
}
