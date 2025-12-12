/**
 * Coordinator Service (Multi-Tenant)
 *
 * Main service that handles multiple projects in a single deployment.
 * Projects are auto-discovered when first request arrives.
 *
 * Components per project:
 * - Extended Coordinator (routing, work management)
 * - Target Registry (dynamic spin-up targets)
 * - Spin-Up Manager (agent lifecycle)
 * - Idle Tracker (scale-down)
 *
 * Shared components:
 * - NATS Connection
 * - REST API (with /api/projects/:projectId routes)
 */

import type { NatsConnection, ConnectionOptions } from 'nats';
import { connect as natsConnect } from 'nats';
import { connect as connectWs } from 'nats.ws';
import ws from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { Server } from 'http';
import type { CoordinatorConfiguration } from '@loom/shared';
import { DEFAULT_COORDINATOR_CONFIG, parseNatsUrl } from '@loom/shared';

// Component imports
import { ProjectManager, type ProjectContext } from './projects/index.js';
import { createExpressApp, startServer, type CoordinatorServiceLayer } from './api/index.js';

/**
 * Service state
 */
interface ServiceState {
  config: CoordinatorConfiguration;
  nc: NatsConnection;
  projectManager: ProjectManager;
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

  // LOOM_PROJECT_ID now becomes the default project (optional)
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
 * Extract project ID from NATS subject
 * Subject format: coord.<projectId>.<resource>.<action>
 */
function extractProjectId(subject: string): string | null {
  const parts = subject.split('.');
  if (parts.length >= 2 && parts[0] === 'coord') {
    return parts[1] ?? null;
  }
  return null;
}

/**
 * Convert channel name to stream name (matches Warp's convention)
 */
function channelToStreamName(projectId: string, channelName: string): string {
  // Convert channel name to uppercase and replace hyphens with underscores
  const streamSuffix = channelName.toUpperCase().replace(/-/g, '_');
  return `${projectId}_${streamSuffix}`;
}

/**
 * Read messages from a JetStream channel stream
 */
async function readMessagesFromStream(
  nc: NatsConnection,
  projectId: string,
  channelName: string,
  limit: number
): Promise<{ timestamp: string; handle: string; message: string }[]> {
  const messages: { timestamp: string; handle: string; message: string }[] = [];
  const streamName = channelToStreamName(projectId, channelName);

  try {
    const jsm = await nc.jetstreamManager();

    // Get stream info to find message range
    const streamInfo = await jsm.streams.info(streamName);
    const { first_seq, last_seq, messages: msgCount } = streamInfo.state;

    if (msgCount === 0) {
      return messages;
    }

    // Calculate start sequence for newest N messages
    const startSeq = Math.max(first_seq, last_seq - limit + 1);

    // Read messages directly from stream by sequence number
    const stream = await jsm.streams.get(streamName);
    for (let seq = startSeq; seq <= last_seq; seq++) {
      try {
        const msg = await stream.getMessage({ seq });
        const data = new TextDecoder().decode(msg.data);

        // Parse the message (Warp stores as JSON with handle, message, timestamp)
        try {
          const parsed = JSON.parse(data);
          messages.push({
            timestamp: parsed.timestamp || msg.time?.toISOString() || new Date().toISOString(),
            handle: parsed.handle || 'unknown',
            message: parsed.message || data,
          });
        } catch {
          // If not JSON, treat as plain text
          messages.push({
            timestamp: msg.time?.toISOString() || new Date().toISOString(),
            handle: 'unknown',
            message: data,
          });
        }
      } catch (err) {
        // Message may have been deleted by retention policy - skip gaps
        const error = err as Error;
        if (!error.message?.includes('no message found')) {
          console.warn('Error reading message', { seq, error: error.message });
        }
      }
    }
  } catch (err) {
    const error = err as Error;
    // Stream doesn't exist yet - not an error
    if (error.message?.includes('stream not found')) {
      return messages;
    }
    throw new Error(`Failed to read messages from ${channelName}: ${error.message}`);
  }

  return messages;
}

/**
 * Create a service layer for a specific project
 */
function createProjectServiceLayer(
  context: ProjectContext,
  nc: NatsConnection
): CoordinatorServiceLayer {
  const { coordinator, targetRegistry, spinUpManager, projectId } = context;

  return {
    // Agent operations
    async listAgents(filter) {
      // If capability filter specified, use findWorkers. Otherwise list all agents.
      const workers = filter?.capability
        ? await coordinator.findWorkers(filter.capability)
        : await coordinator.listAllAgents();

      return workers.filter(a => {
        if (filter?.agentType && a.agentType !== filter.agentType) return false;
        if (filter?.status && a.status !== filter.status) return false;
        return true;
      });
    },

    async getAgent(guid) {
      const workers = await coordinator.listAllAgents();
      return workers.find(w => w.guid === guid) || null;
    },

    async requestAgentShutdown(guid, graceful) {
      nc.publish(`loom.${projectId}.agents.${guid}.shutdown`, JSON.stringify({ graceful }));
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
      coordinator.cancelWork(id);
    },

    // Stats operations
    async getStats() {
      const coordStats = coordinator.getStats();
      const targets = await targetRegistry.getAllTargets();

      const agents = await coordinator.findWorkers('general');
      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};

      for (const agent of agents) {
        byType[agent.agentType] = (byType[agent.agentType] || 0) + 1;
        byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
      }

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

      const startTime = Date.now();
      try {
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

    // Channel operations
    async listChannels(_projectId: string) {
      // Default channels - in production, this would read from config or stream list
      return [
        { name: 'roadmap', description: 'Discussion about project roadmap and planning' },
        { name: 'parallel-work', description: 'Coordination for parallel work among agents' },
        { name: 'errors', description: 'Error reporting and troubleshooting' },
      ];
    },

    async readChannelMessages(projectId: string, channelName: string, limit: number) {
      return readMessagesFromStream(nc, projectId, channelName, limit);
    },
  };
}

/**
 * Create a multi-tenant service layer that routes to project contexts
 */
function createMultiTenantServiceLayer(
  projectManager: ProjectManager,
  nc: NatsConnection,
  defaultProjectId: string
): CoordinatorServiceLayer & { getGlobalStats: () => Promise<any>; listProjects: () => string[] } {
  // Helper to get project context (uses default if not specified)
  const getContext = async (projectId?: string): Promise<ProjectContext> => {
    const pid = projectId || defaultProjectId;
    return projectManager.getOrCreateProject(pid);
  };

  return {
    // Agent operations
    async listAgents(filter) {
      const context = await getContext((filter as any)?.projectId);
      const layer = createProjectServiceLayer(context, nc);
      return layer.listAgents(filter);
    },

    async getAgent(guid) {
      // Search across all projects
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const agent = await layer.getAgent(guid);
        if (agent) return agent;
      }
      return null;
    },

    async requestAgentShutdown(guid, graceful) {
      // Find which project has this agent
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const agent = await layer.getAgent(guid);
        if (agent) {
          await layer.requestAgentShutdown(guid, graceful);
          return;
        }
      }
      throw new Error(`Agent not found: ${guid}`);
    },

    // Work operations
    async listWork(filter) {
      const context = await getContext((filter as any)?.projectId);
      const layer = createProjectServiceLayer(context, nc);
      return layer.listWork(filter);
    },

    async submitWork(request: any) {
      const context = await getContext(request.projectId);
      const layer = createProjectServiceLayer(context, nc);
      return layer.submitWork(request);
    },

    async getWorkItem(id) {
      // Search across all projects
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const work = await layer.getWorkItem(id);
        if (work) return work;
      }
      return null;
    },

    async cancelWorkItem(id) {
      // Find which project has this work item
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const work = await layer.getWorkItem(id);
        if (work) {
          await layer.cancelWorkItem(id);
          return;
        }
      }
      throw new Error(`Work item not found: ${id}`);
    },

    // Stats operations (returns stats for default project)
    async getStats() {
      const context = await getContext();
      const layer = createProjectServiceLayer(context, nc);
      return layer.getStats();
    },

    // Target operations
    async listTargets(filter) {
      const context = await getContext((filter as any)?.projectId);
      const layer = createProjectServiceLayer(context, nc);
      return layer.listTargets(filter);
    },

    async getTarget(idOrName) {
      // Search across all projects
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const target = await layer.getTarget(idOrName);
        if (target) return target;
      }
      return null;
    },

    async registerTarget(request: any) {
      const context = await getContext(request.projectId);
      const layer = createProjectServiceLayer(context, nc);
      return layer.registerTarget(request);
    },

    async updateTarget(idOrName, updates: any) {
      // Find which project has this target
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const target = await layer.getTarget(idOrName);
        if (target) {
          return layer.updateTarget(idOrName, updates);
        }
      }
      throw new Error(`Target not found: ${idOrName}`);
    },

    async removeTarget(idOrName) {
      // Find which project has this target
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const target = await layer.getTarget(idOrName);
        if (target) {
          await layer.removeTarget(idOrName);
          return;
        }
      }
      throw new Error(`Target not found: ${idOrName}`);
    },

    async testTargetHealth(idOrName) {
      // Find which project has this target
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const target = await layer.getTarget(idOrName);
        if (target) {
          return layer.testTargetHealth(idOrName);
        }
      }
      throw new Error(`Target not found: ${idOrName}`);
    },

    async triggerTargetSpinUp(idOrName) {
      // Find which project has this target
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const target = await layer.getTarget(idOrName);
        if (target) {
          return layer.triggerTargetSpinUp(idOrName);
        }
      }
      throw new Error(`Target not found: ${idOrName}`);
    },

    async disableTarget(idOrName) {
      // Find which project has this target
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const target = await layer.getTarget(idOrName);
        if (target) {
          await layer.disableTarget(idOrName);
          return;
        }
      }
      throw new Error(`Target not found: ${idOrName}`);
    },

    async enableTarget(idOrName) {
      // Find which project has this target
      for (const context of projectManager.getAllProjects()) {
        const layer = createProjectServiceLayer(context, nc);
        const target = await layer.getTarget(idOrName);
        if (target) {
          await layer.enableTarget(idOrName);
          return;
        }
      }
      throw new Error(`Target not found: ${idOrName}`);
    },

    // Channel operations
    async listChannels(projectId: string) {
      const context = await getContext(projectId);
      const layer = createProjectServiceLayer(context, nc);
      return layer.listChannels(projectId);
    },

    async readChannelMessages(projectId: string, channelName: string, limit: number) {
      return readMessagesFromStream(nc, projectId, channelName, limit);
    },

    // Multi-tenant specific methods
    async getGlobalStats() {
      return projectManager.getGlobalStats();
    },

    listProjects() {
      return projectManager.listProjects();
    },
  };
}

/**
 * Setup NATS request handlers with wildcard subscriptions (multi-tenant)
 */
function setupNATSHandlers(
  nc: NatsConnection,
  projectManager: ProjectManager
): void {
  const encode = (data: any) => JSON.stringify(data);
  const decode = (data: Uint8Array) => JSON.parse(new TextDecoder().decode(data));

  // Helper to handle requests with project context
  const handleWithProject = (
    handler: (context: ProjectContext, payload: any) => Promise<any>
  ) => {
    return async (err: Error | null, msg: any) => {
      if (err) return;
      try {
        const projectId = extractProjectId(msg.subject);
        if (!projectId) {
          msg.respond(encode({ error: 'Invalid subject: could not extract project ID' }));
          return;
        }

        // Skip reserved project IDs - these are handled by specific subscriptions
        if (projectId === 'global') {
          // Don't respond - let the specific coord.global.* subscription handle it
          return;
        }

        const context = await projectManager.getOrCreateProject(projectId);
        const payload = msg.data.length > 0 ? decode(msg.data) : {};
        const result = await handler(context, payload);
        msg.respond(encode(result));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    };
  };

  // Stats endpoint
  nc.subscribe('coord.*.stats', {
    callback: handleWithProject(async (context) => {
      return context.coordinator.getStats();
    }),
  });

  // Global stats (across all projects)
  nc.subscribe('coord.global.stats', {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const stats = await projectManager.getGlobalStats();
        msg.respond(encode(stats));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // List projects
  nc.subscribe('coord.global.projects', {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const projects = projectManager.listProjects();
        msg.respond(encode({ projects }));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Agents list
  nc.subscribe('coord.*.agents.list', {
    callback: handleWithProject(async (context, filter) => {
      const workers = await context.coordinator.findWorkers(filter.capability || 'general');
      return workers;
    }),
  });

  // Work list
  nc.subscribe('coord.*.work.list', {
    callback: handleWithProject(async (context, filter) => {
      return context.coordinator.getAssignments(filter);
    }),
  });

  // Work submit
  nc.subscribe('coord.*.work.submit', {
    callback: handleWithProject(async (context, request) => {
      return context.coordinator.submitClassifiedWork({
        ...request,
        taskId: request.taskId || uuidv4(),
      });
    }),
  });

  // Work get
  nc.subscribe('coord.*.work.get', {
    callback: handleWithProject(async (context, { id }) => {
      return context.coordinator.getAssignment(id);
    }),
  });

  // Work status (for watching)
  nc.subscribe('coord.*.work.status.*', {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const parts = msg.subject.split('.');
        const projectId = parts[1];
        const workId = parts[parts.length - 1];

        if (!projectId || !workId) {
          msg.respond(encode({ error: 'Invalid subject' }));
          return;
        }

        const context = await projectManager.getOrCreateProject(projectId);
        const work = context.coordinator.getAssignment(workId);
        msg.respond(encode(work));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Work cancel
  nc.subscribe('coord.*.work.cancel', {
    callback: handleWithProject(async (context, { id }) => {
      const success = context.coordinator.cancelWork(id);
      return { success };
    }),
  });

  // Targets list
  nc.subscribe('coord.*.targets.list', {
    callback: handleWithProject(async (context, filter) => {
      return context.targetRegistry.queryTargets(filter);
    }),
  });

  // Targets register
  nc.subscribe('coord.*.targets.register', {
    callback: handleWithProject(async (context, request) => {
      return context.targetRegistry.registerTarget(request);
    }),
  });

  // Targets get
  nc.subscribe('coord.*.targets.get', {
    callback: handleWithProject(async (context, { target }) => {
      return context.targetRegistry.getTarget(target);
    }),
  });

  // Targets update
  nc.subscribe('coord.*.targets.update', {
    callback: handleWithProject(async (context, request) => {
      return context.targetRegistry.updateTarget(request);
    }),
  });

  // Targets remove
  nc.subscribe('coord.*.targets.remove', {
    callback: handleWithProject(async (context, { target }) => {
      await context.targetRegistry.removeTarget(target);
      return { success: true };
    }),
  });

  // Targets test (health check)
  nc.subscribe('coord.*.targets.test', {
    callback: handleWithProject(async (context, { target: targetId }) => {
      const target = await context.targetRegistry.getTarget(targetId);
      if (!target) {
        throw new Error('Target not found');
      }

      const startTime = Date.now();
      try {
        await context.targetRegistry.updateTargetHealth(target.id, 'healthy');
        return {
          healthy: true,
          latencyMs: Date.now() - startTime,
        };
      } catch (healthError: any) {
        await context.targetRegistry.updateTargetHealth(target.id, 'unhealthy', healthError.message);
        return {
          healthy: false,
          error: healthError.message,
          latencyMs: Date.now() - startTime,
        };
      }
    }),
  });

  // Targets enable
  nc.subscribe('coord.*.targets.enable', {
    callback: handleWithProject(async (context, { target }) => {
      await context.targetRegistry.updateTargetStatus(target, 'available');
      return { success: true };
    }),
  });

  // Targets disable
  nc.subscribe('coord.*.targets.disable', {
    callback: handleWithProject(async (context, { target }) => {
      await context.targetRegistry.updateTargetStatus(target, 'disabled');
      return { success: true };
    }),
  });

  // Agent shutdown
  nc.subscribe('coord.*.agents.shutdown', {
    callback: async (err, msg) => {
      if (err) return;
      try {
        const projectId = extractProjectId(msg.subject);
        if (!projectId) {
          msg.respond(encode({ error: 'Invalid subject' }));
          return;
        }

        const { guid, graceful = true } = decode(msg.data);
        nc.publish(`loom.${projectId}.agents.${guid}.shutdown`, JSON.stringify({ graceful }));
        msg.respond(encode({ success: true }));
      } catch (error) {
        msg.respond(encode({ error: String(error) }));
      }
    },
  });

  // Spin-up trigger
  nc.subscribe('coord.*.spin-up.trigger', {
    callback: handleWithProject(async (context, { target: targetId }) => {
      const target = await context.targetRegistry.getTarget(targetId);
      if (!target) {
        throw new Error('Target not found');
      }
      const tracked = await context.spinUpManager.requestSpinUp(target);
      return {
        operationId: tracked.id,
        targetName: target.name,
        status: tracked.status,
      };
    }),
  });

  // Spin-up status
  nc.subscribe('coord.*.spin-up.status', {
    callback: handleWithProject(async (context, { operationId }) => {
      return context.spinUpManager.getTracked(operationId);
    }),
  });

  // Spin-up list
  nc.subscribe('coord.*.spin-up.list', {
    callback: handleWithProject(async (context) => {
      return context.spinUpManager.getAllTracked();
    }),
  });

  console.log('  NATS request handlers registered (multi-tenant wildcard mode)');
}

/**
 * Start the coordinator service (multi-tenant)
 */
export async function startService(): Promise<void> {
  if (state?.isRunning) {
    throw new Error('Service is already running');
  }

  console.log('Starting Coordinator Service (Multi-Tenant)...');

  // Load configuration
  const config = loadConfig();
  // Parse URL early to avoid logging credentials
  const parsedUrl = parseNatsUrl(config.nats.url);
  console.log(`  Default Project ID: ${config.projectId}`);
  console.log(`  NATS URL: ${parsedUrl.server}`);
  console.log(`  API Port: ${config.api.port}`);

  try {
    // Connect to NATS with optional authentication
    console.log('Connecting to NATS...');

    // Use already parsed URL, add env var fallbacks
    const urlUser = parsedUrl.user ?? process.env['NATS_USER'];
    const urlPass = parsedUrl.pass ?? process.env['NATS_PASS'];

    const connectOpts: ConnectionOptions = {
      servers: parsedUrl.server,
      name: 'loom-weft-multitenant',
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
    };

    // Add credentials if available
    if (urlUser) {
      connectOpts.user = urlUser;
      if (urlPass) {
        connectOpts.pass = urlPass;
      }
    }

    const hasAuth = !!urlUser;

    // Use WebSocket transport if URL scheme is ws:// or wss://
    let nc: NatsConnection;
    if (parsedUrl.transport === 'websocket') {
      // Initialize WebSocket shim for Node.js
      (globalThis as unknown as { WebSocket: typeof ws }).WebSocket = ws;
      nc = await connectWs(connectOpts);
      console.log(`  Connected to NATS via WebSocket (authenticated: ${hasAuth})`);
    } else {
      nc = await natsConnect(connectOpts);
      console.log(`  Connected to NATS via TCP (authenticated: ${hasAuth})`);
    }

    // Initialize Project Manager
    console.log('Initializing Project Manager...');
    const projectManager = new ProjectManager(nc, config);
    console.log('  Project Manager initialized');

    // Pre-create default project if specified
    if (config.projectId && config.projectId !== 'default') {
      console.log(`  Pre-creating default project: ${config.projectId}`);
      await projectManager.getOrCreateProject(config.projectId);
    }

    // Initialize state
    state = {
      config,
      nc,
      projectManager,
      isRunning: false,
    };

    // Setup NATS request handlers (wildcard)
    setupNATSHandlers(nc, projectManager);

    // Start REST API if enabled
    if (config.api.enabled) {
      console.log(`Starting REST API on ${config.api.host}:${config.api.port}...`);

      const serviceLayer = createMultiTenantServiceLayer(
        projectManager,
        nc,
        config.projectId
      );

      const app = createExpressApp(config.api, serviceLayer);
      await startServer(app, config.api);
      console.log('  REST API started');
    }

    state.isRunning = true;
    console.log('\n=== Coordinator Service Ready (Multi-Tenant) ===\n');

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
 * Stop the coordinator service
 */
export async function stopService(): Promise<void> {
  if (!state?.isRunning) {
    return;
  }

  console.log('Stopping Coordinator Service...');

  // Shutdown all projects via ProjectManager
  if (state.projectManager) {
    await state.projectManager.shutdown();
    console.log('  All project contexts shut down');
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
export function getServiceStatus(): {
  running: boolean;
  config?: CoordinatorConfiguration;
  projectCount?: number;
  projects?: string[];
} {
  return {
    running: state?.isRunning ?? false,
    config: state?.config,
    projectCount: state?.projectManager?.getProjectCount(),
    projects: state?.projectManager?.listProjects(),
  };
}

/**
 * Get the project manager (for testing or advanced usage)
 */
export function getProjectManager(): ProjectManager | null {
  return state?.projectManager ?? null;
}
