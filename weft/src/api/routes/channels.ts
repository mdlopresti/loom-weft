import { Router } from 'express';
import type { CoordinatorServiceLayer } from '../server.js';
import { APIError } from '../middleware/error.js';

/**
 * Creates the channels router
 */
export function createChannelsRouter(service: CoordinatorServiceLayer): Router {
  const router = Router();

  /**
   * GET /api/channels
   * List available channels for a project
   *
   * Query parameters:
   * - projectId: Project ID (required)
   */
  router.get('/', async (req, res, next) => {
    try {
      const { projectId } = req.query;

      if (!projectId || typeof projectId !== 'string') {
        throw new APIError(400, 'projectId query parameter is required');
      }

      const channels = await service.listChannels(projectId);

      res.json({
        channels,
        count: channels.length,
        projectId,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/channels/:name/messages
   * Read messages from a channel
   *
   * Query parameters:
   * - projectId: Project ID (required)
   * - limit: Maximum number of messages to return (default: 50, max: 1000)
   */
  router.get('/:name/messages', async (req, res, next) => {
    try {
      const { name } = req.params;
      const { projectId, limit: limitStr } = req.query;

      if (!projectId || typeof projectId !== 'string') {
        throw new APIError(400, 'projectId query parameter is required');
      }

      if (!name) {
        throw new APIError(400, 'Channel name is required');
      }

      const limit = Math.min(
        Math.max(1, parseInt(limitStr as string, 10) || 50),
        1000
      );

      const messages = await service.readChannelMessages(projectId, name, limit);

      res.json({
        channel: name,
        messages,
        count: messages.length,
        projectId,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
