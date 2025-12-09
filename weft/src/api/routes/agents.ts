import { Router } from 'express';
import type { CoordinatorServiceLayer } from '../server.js';
import { APIError } from '../middleware/error.js';

/**
 * Creates the agents router
 */
export function createAgentsRouter(service: CoordinatorServiceLayer): Router {
  const router = Router();

  /**
   * GET /api/agents
   * List registered agents
   *
   * Query parameters:
   * - type: Filter by agent type (copilot-cli, claude-code)
   * - status: Filter by status (online, busy, offline)
   * - capability: Filter by capability
   */
  router.get('/', async (req, res, next) => {
    try {
      const { type, status, capability } = req.query;

      const filter: {
        agentType?: string;
        status?: string;
        capability?: string;
      } = {};

      if (type && typeof type === 'string') {
        filter.agentType = type;
      }
      if (status && typeof status === 'string') {
        filter.status = status;
      }
      if (capability && typeof capability === 'string') {
        filter.capability = capability;
      }

      const agents = await service.listAgents(filter);

      res.json({
        agents,
        count: agents.length,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/agents/:guid
   * Get agent details
   */
  router.get('/:guid', async (req, res, next) => {
    try {
      const { guid } = req.params;

      if (!guid) {
        throw new APIError(400, 'Agent GUID is required');
      }

      const agent = await service.getAgent(guid);

      if (!agent) {
        throw new APIError(404, `Agent with GUID ${guid} not found`);
      }

      res.json(agent);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/agents/:guid/shutdown
   * Request agent shutdown
   *
   * Body:
   * - graceful: boolean (optional, default: true) - Wait for current work to complete
   */
  router.post('/:guid/shutdown', async (req, res, next) => {
    try {
      const { guid } = req.params;
      const { graceful = true } = req.body;

      if (!guid) {
        throw new APIError(400, 'Agent GUID is required');
      }

      // Verify agent exists
      const agent = await service.getAgent(guid);
      if (!agent) {
        throw new APIError(404, `Agent with GUID ${guid} not found`);
      }

      await service.requestAgentShutdown(guid, graceful);

      res.json({
        success: true,
        message: `Shutdown request sent to agent ${guid}`,
        graceful,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
