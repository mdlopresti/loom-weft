import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type { SpinUpTarget, SpinUpResult } from '@loom/shared';
import type { TrackedSpinUp } from './types.js';
import { sshSpinUp } from './mechanisms/ssh.js';
import { githubActionsSpinUp } from './mechanisms/github-actions.js';
import { localSpinUp } from './mechanisms/local.js';
import { webhookSpinUp } from './mechanisms/webhook.js';
import { kubernetesSpinUp } from './mechanisms/kubernetes.js';

/**
 * Configuration for spin-up manager
 */
export interface SpinUpManagerConfig {
  /** Default timeout for spin-up operations (ms) */
  defaultTimeoutMs?: number;

  /** Maximum concurrent spin-ups */
  maxConcurrent?: number;
}

/**
 * Manages spin-up operations for agents
 *
 * Features:
 * - Queue spin-up requests
 * - Deduplicate pending requests for the same target
 * - Handle timeouts
 * - Emit status events
 */
export class SpinUpManager extends EventEmitter {
  private tracked = new Map<string, TrackedSpinUp>();
  private pendingByTarget = new Map<string, string>(); // targetId -> operationId
  private timeouts = new Map<string, NodeJS.Timeout>();

  private config: Required<SpinUpManagerConfig>;

  constructor(config: SpinUpManagerConfig = {}) {
    super();
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? 120000, // 2 minutes
      maxConcurrent: config.maxConcurrent ?? 10,
    };
  }

  /**
   * Request a spin-up for a target
   *
   * Deduplicates requests for the same target that are already pending/in-progress.
   */
  async requestSpinUp(
    target: SpinUpTarget,
    workItemId?: string,
    capability?: string
  ): Promise<TrackedSpinUp> {
    // Check for existing pending/in-progress operation for this target
    const existingId = this.pendingByTarget.get(target.id);
    if (existingId) {
      const existing = this.tracked.get(existingId);
      if (existing && (existing.status === 'pending' || existing.status === 'in-progress')) {
        return existing;
      }
    }

    // Create new tracked operation
    const id = uuidv4();
    const now = new Date().toISOString();
    const tracked: TrackedSpinUp = {
      id,
      request: {
        target,
        workItemId,
        capability,
        requestedAt: now,
      },
      status: 'pending',
      startedAt: now,
      timeoutAt: new Date(Date.now() + this.config.defaultTimeoutMs).toISOString(),
    };

    this.tracked.set(id, tracked);
    this.pendingByTarget.set(target.id, id);

    this.emit('spin-up:requested', tracked);

    // Set timeout
    const timeout = setTimeout(() => {
      this.handleTimeout(id);
    }, this.config.defaultTimeoutMs);
    this.timeouts.set(id, timeout);

    // Start spin-up asynchronously
    this.executeSpinUp(id).catch((error) => {
      console.error(`Spin-up execution error for ${id}:`, error);
    });

    return tracked;
  }

  /**
   * Get a tracked spin-up by ID
   */
  getTracked(id: string): TrackedSpinUp | undefined {
    return this.tracked.get(id);
  }

  /**
   * Get all tracked spin-ups
   */
  getAllTracked(): TrackedSpinUp[] {
    return Array.from(this.tracked.values());
  }

  /**
   * Get pending spin-ups for a specific target
   */
  getPendingForTarget(targetId: string): TrackedSpinUp | undefined {
    const id = this.pendingByTarget.get(targetId);
    return id ? this.tracked.get(id) : undefined;
  }

  /**
   * Clear completed/failed operations older than the specified age
   */
  cleanup(maxAgeMs = 3600000): void {
    const cutoff = Date.now() - maxAgeMs;

    for (const [id, tracked] of this.tracked.entries()) {
      if (tracked.completedAt && new Date(tracked.completedAt).getTime() < cutoff) {
        this.tracked.delete(id);
        if (this.pendingByTarget.get(tracked.request.target.id) === id) {
          this.pendingByTarget.delete(tracked.request.target.id);
        }
      }
    }
  }

  /**
   * Execute the spin-up operation
   */
  private async executeSpinUp(id: string): Promise<void> {
    const tracked = this.tracked.get(id);
    if (!tracked) {
      return;
    }

    // Update status
    tracked.status = 'in-progress';
    this.emit('spin-up:started', tracked);

    try {
      // Execute mechanism-specific spin-up
      const result = await this.performSpinUp(tracked.request.target);

      // Update with result
      tracked.status = 'success';
      tracked.result = result;
      tracked.completedAt = new Date().toISOString();

      this.clearTimeout(id);
      this.pendingByTarget.delete(tracked.request.target.id);
      this.emit('spin-up:success', tracked);
    } catch (error) {
      // Handle failure
      tracked.status = 'failed';
      tracked.error = error instanceof Error ? error.message : String(error);
      tracked.completedAt = new Date().toISOString();

      this.clearTimeout(id);
      this.pendingByTarget.delete(tracked.request.target.id);
      this.emit('spin-up:failed', tracked);
    }
  }

  /**
   * Perform the actual spin-up based on mechanism type
   */
  private async performSpinUp(target: SpinUpTarget): Promise<SpinUpResult> {
    switch (target.mechanism) {
      case 'ssh':
        return await sshSpinUp(target);

      case 'github-actions':
        return await githubActionsSpinUp(target);

      case 'local':
        return await localSpinUp(target);

      case 'webhook':
        return await webhookSpinUp(target);

      case 'kubernetes':
        return await kubernetesSpinUp(target);

      default:
        throw new Error(`Unknown spin-up mechanism: ${(target as SpinUpTarget).mechanism}`);
    }
  }

  /**
   * Handle timeout for a spin-up operation
   */
  private handleTimeout(id: string): void {
    const tracked = this.tracked.get(id);
    if (!tracked) {
      return;
    }

    if (tracked.status === 'pending' || tracked.status === 'in-progress') {
      tracked.status = 'timeout';
      tracked.error = 'Spin-up operation timed out';
      tracked.completedAt = new Date().toISOString();

      this.pendingByTarget.delete(tracked.request.target.id);
      this.emit('spin-up:timeout', tracked);
    }
  }

  /**
   * Clear timeout for an operation
   */
  private clearTimeout(id: string): void {
    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }
  }

  /**
   * Cleanup all timeouts and clear state
   */
  destroy(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.tracked.clear();
    this.pendingByTarget.clear();
    this.removeAllListeners();
  }
}
