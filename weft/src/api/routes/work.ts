import { Router } from 'express';
import type { WorkSubmitRequest } from '@loom/shared';
import type { CoordinatorServiceLayer } from '../server.js';
import { APIError } from '../middleware/error.js';

/**
 * Validates boundary (user-defined, just needs to be non-empty string)
 */
function isValidBoundary(boundary: string): boolean {
  return typeof boundary === 'string' && boundary.trim().length > 0;
}

/**
 * Validates priority (1-10)
 */
function isValidPriority(priority: unknown): boolean {
  return (
    typeof priority === 'number' &&
    Number.isInteger(priority) &&
    priority >= 1 &&
    priority <= 10
  );
}

/**
 * Creates the work router
 */
export function createWorkRouter(service: CoordinatorServiceLayer): Router {
  const router = Router();

  /**
   * GET /api/work
   * List pending/active work items
   *
   * Query parameters:
   * - status: Filter by status (pending, assigned, in-progress, completed, failed, cancelled)
   * - boundary: Filter by classification
   */
  router.get('/', async (req, res, next) => {
    try {
      const { status, classification } = req.query;

      const filter: {
        status?: string;
        boundary?: string;
      } = {};

      if (status && typeof status === 'string') {
        filter.status = status;
      }
      if (classification && typeof classification === 'string') {
        filter.boundary = classification;
      }

      const workItems = await service.listWork(filter);

      res.json({
        workItems,
        count: workItems.length,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/work
   * Submit new work item
   *
   * Body: WorkSubmitRequest
   */
  router.post('/', async (req, res, next) => {
    try {
      const request = req.body as Partial<WorkSubmitRequest>;

      // Validate required fields
      if (!request.taskId) {
        throw new APIError(400, 'taskId is required');
      }
      if (!request.boundary) {
        throw new APIError(400, 'classification is required');
      }
      if (!request.capability) {
        throw new APIError(400, 'capability is required');
      }
      if (!request.description) {
        throw new APIError(400, 'description is required');
      }

      // Validate boundary (user-defined)
      if (!isValidBoundary(request.boundary)) {
        throw new APIError(400, 'boundary must be a non-empty string');
      }

      // Validate priority if provided
      if (request.priority !== undefined && !isValidPriority(request.priority)) {
        throw new APIError(
          400,
          'priority must be an integer between 1 and 10',
        );
      }

      // Validate agent types if provided
      if (request.preferredAgentType) {
        if (!['copilot-cli', 'claude-code'].includes(request.preferredAgentType)) {
          throw new APIError(
            400,
            `Invalid preferredAgentType: ${request.preferredAgentType}. Must be copilot-cli or claude-code`,
          );
        }
      }
      if (request.requiredAgentType) {
        if (!['copilot-cli', 'claude-code'].includes(request.requiredAgentType)) {
          throw new APIError(
            400,
            `Invalid requiredAgentType: ${request.requiredAgentType}. Must be copilot-cli or claude-code`,
          );
        }
      }

      const result = await service.submitWork(request);

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/work/:id
   * Get work item status
   */
  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        throw new APIError(400, 'Work item ID is required');
      }

      const workItem = await service.getWorkItem(id);

      if (!workItem) {
        throw new APIError(404, `Work item with ID ${id} not found`);
      }

      res.json(workItem);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/work/:id/cancel
   * Cancel work item
   */
  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        throw new APIError(400, 'Work item ID is required');
      }

      // Verify work item exists
      const workItem = await service.getWorkItem(id);
      if (!workItem) {
        throw new APIError(404, `Work item with ID ${id} not found`);
      }

      await service.cancelWorkItem(id);

      res.json({
        success: true,
        message: `Work item ${id} cancelled`,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
