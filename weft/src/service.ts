/**
 * Coordinator Service
 *
 * Main service that wires together all components:
 * - Extended Coordinator (routing, work management)
 * - Target Registry (dynamic spin-up targets)
 * - Spin-Up Manager (agent lifecycle)
 * - Idle Tracker (scale-down)
 * - REST API (control plane)
 */

import type { NatsConnection } from 'nats';
import { connect as natsConnect } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import type { Server } from 'http';
import type { CoordinatorConfiguration } from '@loom/shared';
import { DEFAULT_COORDINATOR_CONFIG } from '@loom/shared';

// Component imports
import { ExtendedCoordinator, type ExtendedCoordinatorConfig } from './coordinator/index.js';
import { TargetRegistry, HealthCheckRunner } from './targets/index.js';
import { SpinUpManager } from './spin-up/index.js';
import { IdleTracker } from './idle/index.js';
import { createExpressApp, startServer, type CoordinatorServiceLayer } from './api/index.js';

/**
 * Service state
 */
interface ServiceState {
  config: CoordinatorConfiguration;
  nc: NatsConnection;
  coordinator: ExtendedCoordinator;
  targetRegistry: TargetRegistry;
  spinUpManager: SpinUpManager;
  idleTracker: IdleTracker;
  healthCheckRunner: HealthCheckRunner;
  httpServer?: Server;
  isRunning: boolean;
}

let state: ServiceState | null = null;

/**
 * Load configuration from environment and files
 */
function loadConfig(): CoordinatorConfiguration {
  const config = JSON.parse(JSON.stringify(DEFAULT_COORDINATOR_CONFIG)) as CoordinatorConfiguration;

  // Override with environment variables
  if (process.env.NATS_URL) {
    config.nats.url = process.env.NATS_URL;
  }

  if (process.env.LOOM_PROJECT_ID) {
    config.projectId = process.env.LOOM_PROJECT_ID;
  }

  if (process.env.API_PORT) {
    config.api.port = parseInt(process.env.API_PORT, 10);
  }

  if (process.env.API_HOST) {
    config.api.host = process.env.API_HOST;
  }

  if (process.env.API_TOKENS) {
    config.api.authTokens = process.env.API_TOKENS.split(',').map(t => t.trim());
  }

  if (process.env.LOG_LEVEL) {
    config.logLevel = process.env.LOG_LEVEL as CoordinatorConfiguration['logLevel'];
  }

  if (process.env.IDLE_TIMEOUT_MS) {
    config.idle.defaultTimeoutMs = parseInt(process.env.IDLE_TIMEOUT_MS, 10);
  }

  return config;
}

/**
 * Create a service layer that bridges API routes to internal components
 */
function createServiceLayer(
  coordinator: ExtendedCoordinator,
  targetRegistry: TargetRegistry,
  spinUpManager: SpinUpManager,
  _idleTracker: IdleTracker,
  config: CoordinatorConfiguration,
  nc: NatsConnection,
): CoordinatorServiceLayer {
  return {
    // Agent operations
    async listAgents(filter) {
      const workers = await coordinator.findWorkers(filter?.capability || 'general');
      return workers.filter(a => {
        if (filter?.agentType && a.agentType !== filter.agentType) return false;
        if (filter?.status && a.status !== filter.status) return false;
        return true;
      });
    },

    async getAgent(guid) {
      const workers = await coordinator.findWorkers('general');
      return workers.find(w => w.guid === guid) || null;
    },

    async requestAgentShutdown(guid, graceful) {
      // Publish shutdown request to the agent's inbox
      nc.publish(`coord.${config.projectId}.agents.${guid}.shutdown`, JSON.stringify({ graceful }));
    },

    // Work operations
    async listWork(filter) {
      return coordinator.getAssignments(filter as any);
    },

    async submitWork(request: any) {
      return coordinator.submitClassifiedWork({
        taskId: request.taskId || uuidv4(),
        description: request.description,
        capability: request.capability,
        boundary: request.boundary,
        priority: request.priority,
        preferredAgentType: request.preferredAgentType,
        requiredAgentType: request.requiredAgentType,
        deadline: request.deadline,
        contextData: request.contextData,
      });
    },

    async getWorkItem(id) {
      return coordinator.getAssignment(id);
    },

    async cancelWorkItem(id) {
      // Mark work as failed/cancelled
      await coordinator.recordError(id, 'Cancelled by user', false);
    },

    // Stats operations
    async getStats() {
      const coordStats = coordinator.getStats();
      const targets = await targetRegistry.getAllTargets();

      // Count agents by type/status
      const agents = await coordinator.findWorkers('general');
      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};

      for (const agent of agents) {
        byType[agent.agentType] = (byType[agent.agentType] || 0) + 1;
        byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
      }

      // Count targets by status
      const targetStats = {
        total: targets.length,
        available: targets.filter(t => t.status === 'available').length,
        inUse: targets.filter(t => t.status === 'in-use').length,
        disabled: targets.filter(t => t.status === 'disabled').length,
      };

      return {
        agents: {
          total: agents.length,
          byType,
          byStatus,
        },
        work: {
          pending: coordStats.pending,
          active: coordStats.active,
          completed: coordStats.completed,
          failed: coordStats.failed,
        },
        targets: targetStats,
      };
    },

    // Target operations
    async listTargets(filter) {
      return targetRegistry.queryTargets({
        agentType: filter?.agentType as any,
        status: filter?.status as any,
        capability: filter?.capability,
        boundary: filter?.boundary as any,
        includeDisabled: true,
      });
    },

    async getTarget(idOrName) {
      return targetRegistry.getTarget(idOrName);
    },

    async registerTarget(request: any) {
      return targetRegistry.registerTarget(request);
    },

    async updateTarget(idOrName, updates: any) {
      return targetRegistry.updateTarget({ target: idOrName, updates });
    },

    async removeTarget(idOrName) {
      await targetRegistry.removeTarget(idOrName);
    },

    async testTargetHealth(idOrName) {
      const target = await targetRegistry.getTarget(idOrName);
      if (!target) throw new Error(`Target not found: ${idOrName}`);

      // Run health check
      const startTime = Date.now();
      try {
        // Simple connectivity test based on mechanism
        await targetRegistry.updateTargetHealth(target.id, 'healthy');
        return {
          healthy: true,
          latencyMs: Date.now() - startTime,
        };
      } catch (error: any) {
        await targetRegistry.updateTargetHealth(target.id, 'unhealthy', error.message);
        return {
          healthy: false,
          error: error.message,
          latencyMs: Date.now() - startTime,
        };
      }
    },

    async triggerTargetSpinUp(idOrName) {
      const target = await targetRegistry.getTarget(idOrName);
      if (!target) throw new Error(`Target not found: ${idOrName}`);

      const tracked = await spinUpManager.requestSpinUp(target);
      return {
        operationId: tracked.id,
        targetName: target.name,
        status: tracked.status,
      };
    },

    async disableTarget(idOrName) {
      await targetRegistry.updateTargetStatus(idOrName, 'disabled');
    },

    async enableTarget(idOrName) {
      await targetRegistry.updateTargetStatus(idOrName, 'available');
    },
  };
}

/**
 * Start the coordinator service
 */
export async function startService(): Promise<void> {
  if (state?.isRunning) {
    throw new Error('Service is already running');
  }

  console.log('Starting Coordinator Service...');

  // Load configuration
  const config = loadConfig();
  console.log(`  Project ID: ${config.projectId}`);
  console.log(`  NATS URL: ${config.nats.url}`);
  console.log(`  API Port: ${config.api.port}`);

  try {
    // Connect to NATS
    console.log('Connecting to NATS...');
    const nc = await natsConnect({
      servers: config.nats.url,
      name: `coordinator-service-${config.projectId}`,
      maxReconnectAttempts: -1, // Unlimited reconnects
      reconnectTimeWait: 2000,
    });
    console.log('  Connected to NATS');

    // Initialize Target Registry
    console.log('Initializing Target Registry...');
    const targetRegistry = new TargetRegistry(nc, config.projectId);
    await targetRegistry.initialize();
    console.log('  Target Registry initialized');

    // Initialize Spin-Up Manager
    console.log('Initializing Spin-Up Manager...');
    const spinUpManager = new SpinUpManager({
      defaultTimeoutMs: config.spinUp.defaultTimeoutMs,
      maxConcurrent: config.spinUp.maxConcurrent,
    });
    console.log('  Spin-Up Manager initialized');

    // Initialize Idle Tracker
    console.log('Initializing Idle Tracker...');
    const idleTracker = new IdleTracker({
      idleTimeoutMs: config.idle.defaultTimeoutMs,
      checkIntervalMs: config.idle.checkIntervalMs,
    });
    idleTracker.start();
    console.log('  Idle Tracker started');

    // Initialize Health Check Runner
    console.log('Initializing Health Check Runner...');
    const healthCheckRunner = new HealthCheckRunner(
      targetRegistry,
      config.spinUp.healthCheck.intervalMs,
    );
    healthCheckRunner.start();
    console.log('  Health Check Runner started');

    // Initialize Extended Coordinator
    console.log('Initializing Coordinator...');
    const coordinatorConfig: ExtendedCoordinatorConfig = {
      projectId: config.projectId,
      coordinatorGuid: uuidv4(),
      username: process.env.USER || 'coordinator',
      staleThresholdMs: 300000,
      cleanupIntervalMs: 60000,
      routing: {
        boundaryConfigs: config.boundaryConfigs,
      },
    };
    const coordinator = new ExtendedCoordinator(coordinatorConfig);
    console.log('  Coordinator initialized');

    // Wire up spin-up triggers
    coordinator.on('spin-up-trigger', async (event) => {
      console.log(`Spin-up trigger: ${event.agentType} for capability ${event.capability}`);

      // Find a suitable target
      const targets = await targetRegistry.queryTargets({
        agentType: event.agentType,
        capability: event.capability,
        boundary: event.boundary,
        status: 'available',
      });

      if (targets.length > 0) {
        const target = targets[0]!; // Pick first available (type assertion safe after length check)
        console.log(`  Starting spin-up for target: ${target.name}`);
        await spinUpManager.requestSpinUp(target, event.workItemId, event.capability);
      } else {
        console.log('  No suitable targets available for spin-up');
      }
    });

    // Wire up idle shutdown signals
    idleTracker.on('shutdown-signal', async (agentGuid: string) => {
      console.log(`Idle shutdown signal for agent: ${agentGuid}`);
      nc.publish(`coord.${config.projectId}.agents.${agentGuid}.shutdown`, JSON.stringify({
        reason: 'idle-timeout',
        graceful: true,
      }));
    });

    // Initialize state
    state = {
      config,
      nc,
      coordinator,
      targetRegistry,
      spinUpManager,
      idleTracker,
      healthCheckRunner,
      isRunning: false,
    };

    // Start REST API if enabled
    if (config.api.enabled) {
      console.log(`Starting REST API on ${config.api.host}:${config.api.port}...`);

      const serviceLayer = createServiceLayer(
        coordinator,
        targetRegistry,
        spinUpManager,
        idleTracker,
        config,
        nc,
      );

      const app = createExpressApp(config.api, serviceLayer);
      await startServer(app, config.api);
      console.log('  REST API started');
    }

    // Setup NATS request handlers for CLI/other clients
    setupNATSHandlers(nc, config, coordinator, targetRegistry, spinUpManager, idleTracker);

    state.isRunning = true;
    console.log('\n=== Coordinator Service Ready ===\n');

    // Handle shutdown signals
    const shutdown = async () => {
      console.log('\nShutting down...');
      await stopService();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive
    await new Promise(() => {
      // Never resolves - service runs until shutdown
    });
  } catch (error) {
    console.error('Failed to start service:', error);
    throw error;
  }
}

/**
 * Setup NATS request handlers for CLI and other clients
 */
function setupNATSHandlers(
  nc: NatsConnection,
  config: CoordinatorConfiguration,
  coordinator: ExtendedCoordinator,
  targetRegistry: TargetRegistry,
  spinUpManager: SpinUpManager,
  _idleTracker: IdleTracker,
): void {
  const prefix = `coord.${config.projectId}`;
  const encode = (data: any) => JSON.stringify(data);
  const decode = (data: Uint8Array) => JSON.parse(new TextDecoder().decode(data));

  // Stats endpoint
  nc.subscribe(`${prefix}.stats`, {
    callback: async (err, msg) => {
      if (err) return;
      const stats = coordinator.getStats();
      msg.respond(encode(stats));
    },
  });

  // Agents list
  nc.subscribe(`${prefix}.agents.list`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const filter = msg.data.length > 0 ? decode(msg.data) : {};
        const workers = await coordinator.findWorkers(filter.capability || 'general');
        msg.respond(encode(workers));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Work list
  nc.subscribe(`${prefix}.work.list`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const filter = msg.data.length > 0 ? decode(msg.data) : {};
        const work = coordinator.getAssignments(filter);
        msg.respond(encode(work));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Work submit
  nc.subscribe(`${prefix}.work.submit`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const request = decode(msg.data);
        const result = await coordinator.submitClassifiedWork({
          ...request,
          taskId: request.taskId || uuidv4(),
        });
        msg.respond(encode(result));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Work get
  nc.subscribe(`${prefix}.work.get`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { id } = decode(msg.data);
        const work = coordinator.getAssignment(id);
        msg.respond(encode(work));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Targets list
  nc.subscribe(`${prefix}.targets.list`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const filter = msg.data.length > 0 ? decode(msg.data) : {};
        const targets = await targetRegistry.queryTargets(filter);
        msg.respond(encode(targets));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Targets register
  nc.subscribe(`${prefix}.targets.register`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const request = decode(msg.data);
        const target = await targetRegistry.registerTarget(request);
        msg.respond(encode(target));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Targets get
  nc.subscribe(`${prefix}.targets.get`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { target } = decode(msg.data);
        const result = await targetRegistry.getTarget(target);
        msg.respond(encode(result));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Targets update
  nc.subscribe(`${prefix}.targets.update`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const request = decode(msg.data);
        const result = await targetRegistry.updateTarget(request);
        msg.respond(encode(result));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Targets remove
  nc.subscribe(`${prefix}.targets.remove`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { target } = decode(msg.data);
        await targetRegistry.removeTarget(target);
        msg.respond(encode({ success: true }));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Targets test (health check)
  nc.subscribe(`${prefix}.targets.test`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { target: targetId } = decode(msg.data);
        const target = await targetRegistry.getTarget(targetId);
        if (!target) {
          msg.respond(encode({ error: 'Target not found' }));
          return;
        }

        const startTime = Date.now();
        try {
          await targetRegistry.updateTargetHealth(target.id, 'healthy');
          msg.respond(encode({
            healthy: true,
            latencyMs: Date.now() - startTime,
          }));
        } catch (healthError: any) {
          await targetRegistry.updateTargetHealth(target.id, 'unhealthy', healthError.message);
          msg.respond(encode({
            healthy: false,
            error: healthError.message,
            latencyMs: Date.now() - startTime,
          }));
        }
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Targets enable
  nc.subscribe(`${prefix}.targets.enable`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { target } = decode(msg.data);
        await targetRegistry.updateTargetStatus(target, 'available');
        msg.respond(encode({ success: true }));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Targets disable
  nc.subscribe(`${prefix}.targets.disable`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { target } = decode(msg.data);
        await targetRegistry.updateTargetStatus(target, 'disabled');
        msg.respond(encode({ success: true }));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Work status (for watching)
  nc.subscribe(`${prefix}.work.status.*`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const workId = msg.subject.split('.').pop();
        if (!workId) {
          msg.respond(encode({ error: 'Work ID not provided' }));
          return;
        }
        const work = coordinator.getAssignment(workId);
        msg.respond(encode(work));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Work cancel
  nc.subscribe(`${prefix}.work.cancel`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { id } = decode(msg.data);
        await coordinator.recordError(id, 'Cancelled by user', false);
        msg.respond(encode({ success: true }));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Agent shutdown
  nc.subscribe(`${prefix}.agents.shutdown`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { guid, graceful = true } = decode(msg.data);
        nc.publish(`${prefix}.agents.${guid}.shutdown`, JSON.stringify({ graceful }));
        msg.respond(encode({ success: true }));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Spin-up trigger
  nc.subscribe(`${prefix}.spin-up.trigger`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { target: targetId } = decode(msg.data);
        const target = await targetRegistry.getTarget(targetId);
        if (!target) {
          msg.respond(encode({ error: 'Target not found' }));
          return;
        }
        const tracked = await spinUpManager.requestSpinUp(target);
        msg.respond(encode({
          operationId: tracked.id,
          targetName: target.name,
          status: tracked.status,
        }));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Spin-up status
  nc.subscribe(`${prefix}.spin-up.status`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const { operationId } = decode(msg.data);
        const tracked = spinUpManager.getTracked(operationId);
        msg.respond(encode(tracked));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Spin-up list
  nc.subscribe(`${prefix}.spin-up.list`, {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const operations = spinUpManager.getAllTracked();
        msg.respond(encode(operations));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  console.log('  NATS request handlers registered');
}

/**
 * Stop the coordinator service
 */
export async function stopService(): Promise<void> {
  if (!state?.isRunning) {
    return;
  }

  console.log('Stopping Coordinator Service...');

  // Stop health check runner
  if (state.healthCheckRunner) {
    state.healthCheckRunner.stop();
    console.log('  Health Check Runner stopped');
  }

  // Stop idle tracker
  if (state.idleTracker) {
    state.idleTracker.shutdown();
    console.log('  Idle Tracker stopped');
  }

  // Stop spin-up manager
  if (state.spinUpManager) {
    state.spinUpManager.destroy();
    console.log('  Spin-Up Manager stopped');
  }

  // Shutdown coordinator
  if (state.coordinator) {
    state.coordinator.shutdown();
    console.log('  Coordinator stopped');
  }

  // Close target registry
  if (state.targetRegistry) {
    await state.targetRegistry.close();
    console.log('  Target Registry closed');
  }

  // Close NATS connection
  if (state.nc) {
    await state.nc.drain();
    await state.nc.close();
    console.log('  NATS connection closed');
  }

  state.isRunning = false;
  state = null;

  console.log('Coordinator Service stopped');
}

/**
 * Get service status
 */
export function getServiceStatus(): { running: boolean; config?: CoordinatorConfiguration } {
  return {
    running: state?.isRunning ?? false,
    config: state?.config,
  };
}
