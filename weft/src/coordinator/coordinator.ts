/**
 * Extended Coordinator
 *
 * Extends the base coordinator with:
 * - Classification-aware routing
 * - Agent type preference handling
 * - Spin-up trigger hooks (emits events, doesn't implement spin-up)
 * - Event emitters for state changes
 */

import { EventEmitter } from 'events';
import type {
  Boundary,
  AgentType,
  RegisteredAgent,
  WorkSubmitResponse,
} from '@loom/shared';
import { BaseCoordinator, type BaseCoordinatorConfig, type WorkRequest } from './base-coordinator.js';
import {
  listRegistryEntries,
  isVisibleTo,
  toRegisteredAgent,
  type Requester,
} from './registry.js';
import { RoutingEngine, type RoutingEngineConfig } from '../routing/engine.js';

export interface ExtendedCoordinatorConfig extends BaseCoordinatorConfig {
  /** Coordinator's own GUID for visibility checks */
  coordinatorGuid: string;

  /** Project ID for namespace isolation */
  projectId: string;

  /** Username for visibility checks */
  username?: string;

  /** Routing engine configuration */
  routing?: RoutingEngineConfig;
}

export interface ClassifiedWorkRequest extends WorkRequest {
  /** Work classification for routing */
  boundary: Boundary;

  /** Preferred agent type (overrides routing preference) */
  preferredAgentType?: AgentType;

  /** Required agent type (overrides all routing logic) */
  requiredAgentType?: AgentType;
}

/**
 * Spin-up trigger event
 */
export interface SpinUpTriggerEvent {
  /** Target agent type to spin up */
  agentType: AgentType;

  /** Required capability */
  capability: string;

  /** Work classification */
  boundary: Boundary;

  /** Work item ID that triggered the spin-up */
  workItemId: string;

  /** Timestamp */
  timestamp: string;
}

/**
 * Work state change event
 */
export interface WorkStateChangeEvent {
  /** Work item ID */
  workItemId: string;

  /** Previous status */
  previousStatus: string;

  /** New status */
  newStatus: string;

  /** Timestamp */
  timestamp: string;
}

/**
 * Extended coordinator with classification-aware routing
 *
 * Events:
 * - 'spin-up-trigger': Emitted when no agents available (SpinUpTriggerEvent)
 * - 'work-submitted': Emitted when work is submitted (workItemId: string)
 * - 'work-assigned': Emitted when work is assigned (workItemId: string, agentGuid: string)
 * - 'work-completed': Emitted when work completes (workItemId: string)
 * - 'work-failed': Emitted when work fails (workItemId: string, error: string)
 * - 'routing-decision': Emitted after routing decision (RoutingDecision)
 */
export class ExtendedCoordinator extends EventEmitter {
  private baseCoordinator: BaseCoordinator;
  private routingEngine: RoutingEngine;
  private config: ExtendedCoordinatorConfig;

  constructor(config: ExtendedCoordinatorConfig) {
    super();
    this.config = config;
    this.baseCoordinator = new BaseCoordinator({
      staleThresholdMs: config.staleThresholdMs,
      cleanupIntervalMs: config.cleanupIntervalMs,
    });
    this.routingEngine = new RoutingEngine(config.routing);
  }

  /**
   * Get requester context for visibility checks
   */
  private getRequester(): Requester {
    const requester: Requester = {
      guid: this.config.coordinatorGuid,
      projectId: this.config.projectId,
    };
    if (this.config.username) {
      requester.username = this.config.username;
    }
    return requester;
  }

  /**
   * Find workers for a capability with classification filtering
   */
  async findWorkers(
    capability: string,
    classification?: Boundary
  ): Promise<RegisteredAgent[]> {
    const requester = this.getRequester();
    const allEntries = await listRegistryEntries();

    const workers = allEntries
      .filter(entry => {
        // Must have the required capability
        if (!entry.capabilities.includes(capability)) {
          return false;
        }

        // Must be online or busy (not offline)
        if (entry.status === 'offline') {
          return false;
        }

        // Must be visible to coordinator
        if (!isVisibleTo(entry, requester)) {
          return false;
        }

        // Don't assign to self
        if (entry.guid === this.config.coordinatorGuid) {
          return false;
        }

        return true;
      })
      .map(entry => toRegisteredAgent(entry));

    // Apply classification filtering if specified
    if (classification) {
      return this.routingEngine.filterEligible(workers, classification);
    }

    return workers;
  }

  /**
   * Submit classified work with routing
   *
   * @param request Classified work request
   * @returns Work submission response
   */
  async submitClassifiedWork(request: ClassifiedWorkRequest): Promise<WorkSubmitResponse> {
    const now = new Date().toISOString();

    // Determine target agent type
    let targetAgentType: AgentType;
    let routingDecision;

    if (request.requiredAgentType) {
      // Required type overrides all routing
      targetAgentType = request.requiredAgentType;
      routingDecision = {
        boundary: request.boundary,
        targetAgentType,
        isFallback: false,
        consideredTypes: [targetAgentType],
        reason: 'Required agent type specified',
      };
    } else {
      // Find available workers
      const workers = await this.findWorkers(request.capability, request.boundary);
      const availableTypes = Array.from(new Set(workers.map(w => w.agentType)));

      // Use routing engine
      routingDecision = this.routingEngine.resolveAgentType(
        request.boundary,
        availableTypes.length > 0 ? availableTypes : undefined
      );

      // Apply preferred type if specified and available
      if (request.preferredAgentType && routingDecision.consideredTypes.includes(request.preferredAgentType)) {
        targetAgentType = request.preferredAgentType;
        routingDecision.targetAgentType = targetAgentType;
        routingDecision.reason = 'User-specified preferred type (available)';
      } else {
        targetAgentType = routingDecision.targetAgentType;
      }
    }

    // Emit routing decision
    this.emit('routing-decision', routingDecision);

    // Find eligible workers for the target agent type
    const eligibleWorkers = await this.findWorkers(request.capability, request.boundary);
    const targetWorkers = eligibleWorkers.filter(w => w.agentType === targetAgentType);

    let spinUpTriggered = false;

    // Trigger spin-up if no eligible workers
    if (targetWorkers.length === 0) {
      const shouldSpinUp = this.routingEngine.shouldTriggerSpinUp(request.boundary);

      if (shouldSpinUp) {
        const spinUpEvent: SpinUpTriggerEvent = {
          agentType: targetAgentType,
          capability: request.capability,
          boundary: request.boundary,
          workItemId: '', // Will be set after work is submitted
          timestamp: now,
        };

        // Emit spin-up trigger event (don't implement spin-up here)
        this.emit('spin-up-trigger', spinUpEvent);
        spinUpTriggered = true;
      }
    }

    // Submit work via base coordinator
    const workItemId = this.baseCoordinator.submitWork(request);

    // Update the work item with classification
    const workItem = this.baseCoordinator.getWorkItem(workItemId);
    if (workItem) {
      workItem.boundary = request.boundary;
      workItem.preferredAgentType = request.preferredAgentType;
      workItem.requiredAgentType = request.requiredAgentType;
    }

    // Emit work submitted event
    this.emit('work-submitted', workItemId);

    // Update spin-up event with work item ID if triggered
    if (spinUpTriggered) {
      const spinUpEvent: SpinUpTriggerEvent = {
        agentType: targetAgentType,
        capability: request.capability,
        boundary: request.boundary,
        workItemId,
        timestamp: now,
      };
      this.emit('spin-up-trigger', spinUpEvent);
    }

    // Estimate wait time based on available workers
    let estimatedWaitSeconds: number | undefined;
    if (targetWorkers.length === 0) {
      estimatedWaitSeconds = spinUpTriggered ? 30 : undefined; // Estimate 30s for spin-up
    } else {
      estimatedWaitSeconds = 5; // Estimate 5s if workers available
    }

    return {
      workItemId,
      targetAgentType,
      spinUpTriggered,
      estimatedWaitSeconds,
    };
  }

  /**
   * Record that a worker has claimed work
   */
  async recordClaim(workItemId: string, workerGuid: string): Promise<boolean> {
    const result = await this.baseCoordinator.recordClaim(workItemId, workerGuid);
    if (result) {
      this.emit('work-assigned', workItemId, workerGuid);
    }
    return result;
  }

  /**
   * Record work completion
   */
  recordCompletion(
    workItemId: string,
    result?: Record<string, unknown>,
    summary?: string
  ): boolean {
    const completed = this.baseCoordinator.recordCompletion(workItemId, result, summary);
    if (completed) {
      this.emit('work-completed', workItemId);
    }
    return completed;
  }

  /**
   * Record work error
   */
  async recordError(
    workItemId: string,
    error: string,
    recoverable: boolean
  ): Promise<boolean> {
    const result = await this.baseCoordinator.recordError(workItemId, error, recoverable);
    if (result) {
      this.emit('work-failed', workItemId, error);
    }
    return result;
  }

  /**
   * Get assignment status (delegate to base coordinator)
   */
  getAssignment(workItemId: string) {
    return this.baseCoordinator.getAssignment(workItemId);
  }

  /**
   * Get all assignments (delegate to base coordinator)
   */
  getAssignments(filter?: Parameters<BaseCoordinator['getAssignments']>[0]) {
    return this.baseCoordinator.getAssignments(filter);
  }

  /**
   * Get statistics (delegate to base coordinator)
   */
  getStats() {
    return this.baseCoordinator.getStats();
  }

  /**
   * Get routing engine
   */
  getRoutingEngine(): RoutingEngine {
    return this.routingEngine;
  }

  /**
   * Clean up all resources
   */
  shutdown(): void {
    this.baseCoordinator.shutdown();
    this.removeAllListeners();
  }
}

/**
 * Create an extended coordinator instance
 */
export function createExtendedCoordinator(config: ExtendedCoordinatorConfig): ExtendedCoordinator {
  return new ExtendedCoordinator(config);
}
