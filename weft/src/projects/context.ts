/**
 * Project Context
 *
 * Contains all the per-project components needed for coordination.
 * Each project gets its own isolated context with separate registries,
 * coordinators, and trackers.
 */

import type { NatsConnection } from 'nats';
import type { CoordinatorConfiguration } from '@loom/shared';
import { ExtendedCoordinator, type ExtendedCoordinatorConfig, initializeRegistry } from '../coordinator/index.js';
import { TargetRegistry, HealthCheckRunner } from '../targets/index.js';
import { SpinUpManager } from '../spin-up/index.js';
import { IdleTracker } from '../idle/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Per-project context containing all coordination components
 */
export interface ProjectContext {
  projectId: string;
  coordinator: ExtendedCoordinator;
  targetRegistry: TargetRegistry;
  spinUpManager: SpinUpManager;
  idleTracker: IdleTracker;
  healthCheckRunner: HealthCheckRunner;
  createdAt: Date;
  lastActivityAt: Date;
}

/**
 * Options for creating a project context
 */
export interface ProjectContextOptions {
  nc: NatsConnection;
  projectId: string;
  config: CoordinatorConfiguration;
}

/**
 * Create a new project context with all required components
 */
export async function createProjectContext(
  options: ProjectContextOptions
): Promise<ProjectContext> {
  const { nc, projectId, config } = options;
  const now = new Date();

  console.log(`Creating project context for: ${projectId}`);

  // Initialize shared agent registry (reads from Warp's agent-registry KV bucket)
  await initializeRegistry(nc, projectId);
  console.log(`  Agent registry initialized for project: ${projectId}`);

  // Initialize Target Registry
  const targetRegistry = new TargetRegistry(nc, projectId);
  await targetRegistry.initialize();

  // Initialize Spin-Up Manager
  const spinUpManager = new SpinUpManager({
    defaultTimeoutMs: config.spinUp.defaultTimeoutMs,
    maxConcurrent: config.spinUp.maxConcurrent,
  });

  // Initialize Idle Tracker
  const idleTracker = new IdleTracker({
    idleTimeoutMs: config.idle.defaultTimeoutMs,
    checkIntervalMs: config.idle.checkIntervalMs,
  });
  idleTracker.start();

  // Initialize Health Check Runner
  const healthCheckRunner = new HealthCheckRunner(
    targetRegistry,
    config.spinUp.healthCheck.intervalMs
  );
  healthCheckRunner.start();

  // Initialize Extended Coordinator
  const coordinatorConfig: ExtendedCoordinatorConfig = {
    projectId,
    coordinatorGuid: uuidv4(),
    username: process.env.USER || 'coordinator',
    staleThresholdMs: 300000,
    cleanupIntervalMs: 60000,
    routing: {
      boundaryConfigs: config.boundaryConfigs,
    },
  };
  const coordinator = new ExtendedCoordinator(coordinatorConfig);

  // Wire up spin-up triggers
  coordinator.on('spin-up-trigger', async (event) => {
    console.log(`[${projectId}] Spin-up trigger: ${event.agentType} for capability ${event.capability}`);

    const targets = await targetRegistry.queryTargets({
      agentType: event.agentType,
      capability: event.capability,
      boundary: event.boundary,
      status: 'available',
    });

    if (targets.length > 0) {
      const target = targets[0]!;
      console.log(`[${projectId}] Starting spin-up for target: ${target.name}`);
      await spinUpManager.requestSpinUp(target, event.workItemId, event.capability);
    } else {
      console.log(`[${projectId}] No suitable targets available for spin-up`);
    }
  });

  // Wire up idle shutdown signals
  idleTracker.on('shutdown-signal', async (agentGuid: string) => {
    console.log(`[${projectId}] Idle shutdown signal for agent: ${agentGuid}`);
    nc.publish(`loom.${projectId}.agents.${agentGuid}.shutdown`, JSON.stringify({
      reason: 'idle-timeout',
      graceful: true,
    }));
  });

  console.log(`Project context created for: ${projectId}`);

  return {
    projectId,
    coordinator,
    targetRegistry,
    spinUpManager,
    idleTracker,
    healthCheckRunner,
    createdAt: now,
    lastActivityAt: now,
  };
}

/**
 * Shutdown a project context and clean up resources
 */
export async function shutdownProjectContext(context: ProjectContext): Promise<void> {
  console.log(`Shutting down project context: ${context.projectId}`);

  context.healthCheckRunner.stop();
  context.idleTracker.shutdown();
  context.spinUpManager.destroy();
  context.coordinator.shutdown();
  await context.targetRegistry.close();

  console.log(`Project context shutdown complete: ${context.projectId}`);
}
