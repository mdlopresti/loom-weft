import express, { type Express } from 'express';
import cors from 'cors';
import type { APIConfiguration } from '@loom/shared';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

// Import route handlers (will be created)
import { createAgentsRouter } from './routes/agents.js';
import { createWorkRouter } from './routes/work.js';
import { createStatsRouter } from './routes/stats.js';
import { createTargetsRouter } from './routes/targets.js';

/**
 * Service layer interface
 *
 * This is a stub interface that routes will use to interact with
 * the coordinator business logic. Other streams will implement these.
 */
export interface CoordinatorServiceLayer {
  // Agent operations
  listAgents(filter?: {
    agentType?: string;
    status?: string;
    capability?: string;
  }): Promise<unknown[]>;

  getAgent(guid: string): Promise<unknown | null>;

  requestAgentShutdown(guid: string, graceful: boolean): Promise<void>;

  // Work operations
  listWork(filter?: {
    status?: string;
    boundary?: string;
  }): Promise<unknown[]>;

  submitWork(request: unknown): Promise<unknown>;

  getWorkItem(id: string): Promise<unknown | null>;

  cancelWorkItem(id: string): Promise<void>;

  // Stats operations
  getStats(): Promise<{
    agents: {
      total: number;
      byType: Record<string, number>;
      byStatus: Record<string, number>;
    };
    work: {
      pending: number;
      active: number;
      completed: number;
      failed: number;
    };
    targets: {
      total: number;
      available: number;
      inUse: number;
      disabled: number;
    };
  }>;

  // Target operations
  listTargets(filter?: {
    agentType?: string;
    status?: string;
    capability?: string;
    boundary?: string;
  }): Promise<unknown[]>;

  getTarget(idOrName: string): Promise<unknown | null>;

  registerTarget(request: unknown): Promise<unknown>;

  updateTarget(idOrName: string, updates: unknown): Promise<unknown>;

  removeTarget(idOrName: string): Promise<void>;

  testTargetHealth(idOrName: string): Promise<unknown>;

  triggerTargetSpinUp(idOrName: string): Promise<unknown>;

  disableTarget(idOrName: string): Promise<void>;

  enableTarget(idOrName: string): Promise<void>;
}

/**
 * Creates and configures the Express application
 */
export function createExpressApp(
  config: APIConfiguration,
  serviceLayer: CoordinatorServiceLayer,
): Express {
  const app = express();

  // Basic middleware
  app.use(express.json());

  // CORS configuration
  const corsOptions = config.corsOrigins
    ? { origin: config.corsOrigins }
    : {};
  app.use(cors(corsOptions));

  // Authentication middleware (if tokens configured)
  const authMiddleware = createAuthMiddleware(config.authTokens);
  app.use('/api', authMiddleware);

  // API routes
  app.use('/api/agents', createAgentsRouter(serviceLayer));
  app.use('/api/work', createWorkRouter(serviceLayer));
  app.use('/api/stats', createStatsRouter(serviceLayer));
  app.use('/api/targets', createTargetsRouter(serviceLayer));

  // Health check endpoint (no auth required)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 404 handler
  app.use(notFoundHandler);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Starts the Express server
 */
export async function startServer(
  app: Express,
  config: APIConfiguration,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(`API server listening on http://${config.host}:${config.port}`);
      resolve();
    });

    server.on('error', reject);
  });
}
