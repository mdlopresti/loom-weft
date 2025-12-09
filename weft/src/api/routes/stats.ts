import { Router } from 'express';
import type { CoordinatorServiceLayer } from '../server.js';

/**
 * Creates the stats router
 */
export function createStatsRouter(service: CoordinatorServiceLayer): Router {
  const router = Router();

  /**
   * GET /api/stats
   * Get coordinator statistics
   *
   * Returns:
   * - Agent counts (total, by type, by status)
   * - Work queue depth (by status)
   * - Target counts (total, by status)
   */
  router.get('/', async (_req, res, next) => {
    try {
      const stats = await service.getStats();

      res.json({
        timestamp: new Date().toISOString(),
        ...stats,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
