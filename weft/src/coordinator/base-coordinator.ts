/**
 * Base Coordinator
 *
 * Handles work item storage, assignment tracking, and completion recording.
 * Uses in-memory storage with optional persistence callbacks.
 */

import type {
  CoordinatedWorkItem,
  WorkItemStatus,
  Priority,
} from '@loom/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * Work request for submission
 */
export interface WorkRequest {
  taskId: string;
  description: string;
  capability: string;
  priority?: Priority;
  deadline?: string;
  contextData?: Record<string, unknown>;
}

/**
 * Base coordinator configuration
 */
export interface BaseCoordinatorConfig {
  /** How long before unassigned work is considered stale (ms) */
  staleThresholdMs?: number;
  /** How often to clean up stale work (ms) */
  cleanupIntervalMs?: number;
}

/**
 * Assignment filter for querying work items
 */
export interface AssignmentFilter {
  status?: WorkItemStatus;
  capability?: string;
  assignedTo?: string;
}

/**
 * Coordinator statistics
 */
export interface CoordinatorStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
}

/**
 * Base coordinator class for work management
 */
export class BaseCoordinator {
  private workItems: Map<string, CoordinatedWorkItem> = new Map();
  private config: Required<BaseCoordinatorConfig>;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: BaseCoordinatorConfig = {}) {
    this.config = {
      staleThresholdMs: config.staleThresholdMs ?? 300000, // 5 minutes
      cleanupIntervalMs: config.cleanupIntervalMs ?? 60000, // 1 minute
    };

    // Start cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanupStaleWork(),
      this.config.cleanupIntervalMs
    );
  }

  /**
   * Submit new work
   * @returns Work item ID
   */
  submitWork(request: WorkRequest): string {
    const id = uuidv4();
    const now = new Date().toISOString();

    const workItem: CoordinatedWorkItem = {
      id,
      taskId: request.taskId,
      description: request.description,
      capability: request.capability,
      priority: request.priority ?? 5,
      deadline: request.deadline,
      contextData: request.contextData,
      boundary: 'personal', // Default, will be overridden by ExtendedCoordinator
      status: 'pending',
      offeredBy: 'coordinator',
      offeredAt: now,
      attempts: 0,
    };

    this.workItems.set(id, workItem);
    return id;
  }

  /**
   * Get a work item by ID
   */
  getWorkItem(id: string): CoordinatedWorkItem | undefined {
    return this.workItems.get(id);
  }

  /**
   * Record that a worker has claimed work
   * @returns true if claim was successful
   */
  async recordClaim(workItemId: string, workerGuid: string): Promise<boolean> {
    const workItem = this.workItems.get(workItemId);
    if (!workItem) {
      return false;
    }

    // Only allow claiming pending work
    if (workItem.status !== 'pending') {
      return false;
    }

    workItem.status = 'assigned';
    workItem.assignedTo = workerGuid;
    workItem.assignedAt = new Date().toISOString();
    workItem.attempts += 1;

    return true;
  }

  /**
   * Update work item status to in-progress
   */
  startWork(workItemId: string): boolean {
    const workItem = this.workItems.get(workItemId);
    if (!workItem || workItem.status !== 'assigned') {
      return false;
    }

    workItem.status = 'in-progress';
    return true;
  }

  /**
   * Update work progress
   */
  updateProgress(workItemId: string, progress: number): boolean {
    const workItem = this.workItems.get(workItemId);
    if (!workItem || (workItem.status !== 'assigned' && workItem.status !== 'in-progress')) {
      return false;
    }

    workItem.progress = Math.min(100, Math.max(0, progress));
    return true;
  }

  /**
   * Record work completion
   */
  recordCompletion(
    workItemId: string,
    result?: Record<string, unknown>,
    summary?: string
  ): boolean {
    const workItem = this.workItems.get(workItemId);
    if (!workItem) {
      return false;
    }

    workItem.status = 'completed';
    workItem.progress = 100;
    workItem.result = {
      summary,
      output: result,
      completedAt: new Date().toISOString(),
    };

    return true;
  }

  /**
   * Record work error
   */
  async recordError(
    workItemId: string,
    errorMessage: string,
    recoverable: boolean
  ): Promise<boolean> {
    const workItem = this.workItems.get(workItemId);
    if (!workItem) {
      return false;
    }

    workItem.status = 'failed';
    workItem.error = {
      message: errorMessage,
      recoverable,
      occurredAt: new Date().toISOString(),
    };

    return true;
  }

  /**
   * Cancel work
   */
  cancelWork(workItemId: string): boolean {
    const workItem = this.workItems.get(workItemId);
    if (!workItem) {
      return false;
    }

    if (workItem.status === 'completed' || workItem.status === 'failed') {
      return false;
    }

    workItem.status = 'cancelled';
    return true;
  }

  /**
   * Get assignment status
   */
  getAssignment(workItemId: string): CoordinatedWorkItem | undefined {
    return this.workItems.get(workItemId);
  }

  /**
   * Get all assignments matching a filter
   */
  getAssignments(filter?: AssignmentFilter): CoordinatedWorkItem[] {
    const results: CoordinatedWorkItem[] = [];

    for (const workItem of this.workItems.values()) {
      if (filter?.status && workItem.status !== filter.status) {
        continue;
      }
      if (filter?.capability && workItem.capability !== filter.capability) {
        continue;
      }
      if (filter?.assignedTo && workItem.assignedTo !== filter.assignedTo) {
        continue;
      }
      results.push(workItem);
    }

    // Sort by priority (higher first), then by offered time (older first)
    return results.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return new Date(a.offeredAt).getTime() - new Date(b.offeredAt).getTime();
    });
  }

  /**
   * Get pending work for a capability
   */
  getPendingWork(capability: string): CoordinatedWorkItem[] {
    return this.getAssignments({ status: 'pending', capability });
  }

  /**
   * Get statistics
   */
  getStats(): CoordinatorStats {
    let pending = 0;
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (const workItem of this.workItems.values()) {
      switch (workItem.status) {
        case 'pending':
          pending++;
          break;
        case 'assigned':
        case 'in-progress':
          active++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
        case 'cancelled':
          failed++;
          break;
      }
    }

    return {
      pending,
      active,
      completed,
      failed,
      total: this.workItems.size,
    };
  }

  /**
   * Clean up stale work items
   */
  private cleanupStaleWork(): void {
    const now = Date.now();
    const staleThreshold = this.config.staleThresholdMs;

    for (const [id, workItem] of this.workItems) {
      // Remove completed/failed work older than stale threshold
      if (
        workItem.status === 'completed' ||
        workItem.status === 'failed' ||
        workItem.status === 'cancelled'
      ) {
        const completedAt = workItem.result?.completedAt || workItem.error?.occurredAt;
        if (completedAt) {
          const age = now - new Date(completedAt).getTime();
          if (age > staleThreshold * 2) {
            // Keep completed work twice as long
            this.workItems.delete(id);
          }
        }
      }

      // Reset assigned work that's been stuck too long
      if (workItem.status === 'assigned' && workItem.assignedAt) {
        const age = now - new Date(workItem.assignedAt).getTime();
        if (age > staleThreshold) {
          // Reset to pending for re-assignment
          workItem.status = 'pending';
          workItem.assignedTo = undefined;
          workItem.assignedAt = undefined;
        }
      }
    }
  }

  /**
   * Shutdown the coordinator
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
