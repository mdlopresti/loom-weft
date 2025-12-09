import { Router } from 'express';
import type { TargetRegisterRequest } from '@loom/shared';
import type { CoordinatorServiceLayer } from '../server.js';
import { APIError } from '../middleware/error.js';

/**
 * Validates target registration request
 */
function validateTargetRegisterRequest(
  request: Partial<TargetRegisterRequest>,
): void {
  if (!request.name) {
    throw new APIError(400, 'name is required');
  }
  if (!request.agentType) {
    throw new APIError(400, 'agentType is required');
  }
  if (!['copilot-cli', 'claude-code'].includes(request.agentType)) {
    throw new APIError(
      400,
      `Invalid agentType: ${request.agentType}. Must be copilot-cli or claude-code`,
    );
  }
  if (!request.capabilities || !Array.isArray(request.capabilities)) {
    throw new APIError(400, 'capabilities must be a non-empty array');
  }
  if (request.capabilities.length === 0) {
    throw new APIError(400, 'capabilities must contain at least one item');
  }
  if (!request.mechanism) {
    throw new APIError(400, 'mechanism is required');
  }
  if (
    !['ssh', 'github-actions', 'local', 'webhook', 'kubernetes'].includes(
      request.mechanism,
    )
  ) {
    throw new APIError(
      400,
      `Invalid mechanism: ${request.mechanism}. Must be one of: ssh, github-actions, local, webhook, kubernetes`,
    );
  }
  if (!request.config) {
    throw new APIError(400, 'config is required');
  }

  // Validate mechanism-specific config
  const config = request.config as any;
  if (config.mechanism !== request.mechanism) {
    throw new APIError(
      400,
      `config.mechanism must match top-level mechanism (${request.mechanism})`,
    );
  }

  // Validate boundaries if provided (user-defined, just check array format)
  if (request.boundaries) {
    if (!Array.isArray(request.boundaries)) {
      throw new APIError(400, 'boundaries must be an array');
    }
    for (const boundary of request.boundaries) {
      if (typeof boundary !== 'string' || boundary.trim().length === 0) {
        throw new APIError(400, 'Each boundary must be a non-empty string');
      }
    }
  }
}

/**
 * Creates the targets router
 */
export function createTargetsRouter(service: CoordinatorServiceLayer): Router {
  const router = Router();

  /**
   * GET /api/targets
   * List all spin-up targets
   *
   * Query parameters:
   * - type: Filter by agent type
   * - status: Filter by status (available, in-use, disabled, error)
   * - capability: Filter by capability
   * - boundary: Filter by allowed classification
   */
  router.get('/', async (req, res, next) => {
    try {
      const { type, status, capability, classification } = req.query;

      const filter: {
        agentType?: string;
        status?: string;
        capability?: string;
        boundary?: string;
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
      if (classification && typeof classification === 'string') {
        filter.boundary = classification;
      }

      const targets = await service.listTargets(filter);

      res.json({
        targets,
        count: targets.length,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/targets/:id
   * Get target details
   */
  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        throw new APIError(400, 'Target ID or name is required');
      }

      const target = await service.getTarget(id);

      if (!target) {
        throw new APIError(404, `Target with ID or name ${id} not found`);
      }

      res.json(target);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/targets
   * Register new target
   *
   * Body: TargetRegisterRequest
   */
  router.post('/', async (req, res, next) => {
    try {
      const request = req.body as Partial<TargetRegisterRequest>;

      // Validate request
      validateTargetRegisterRequest(request);

      const target = await service.registerTarget(request);

      res.status(201).json(target);
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/targets/:id
   * Update target
   *
   * Body: Partial target updates
   */
  router.put('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      if (!id) {
        throw new APIError(400, 'Target ID or name is required');
      }

      // Verify target exists
      const existingTarget = await service.getTarget(id);
      if (!existingTarget) {
        throw new APIError(404, `Target with ID or name ${id} not found`);
      }

      // Validate boundaries if being updated (user-defined, just check array format)
      if (updates.boundaries) {
        if (!Array.isArray(updates.boundaries)) {
          throw new APIError(400, 'boundaries must be an array');
        }
        for (const boundary of updates.boundaries) {
          if (typeof boundary !== 'string' || boundary.trim().length === 0) {
            throw new APIError(400, 'Each boundary must be a non-empty string');
          }
        }
      }

      const updatedTarget = await service.updateTarget(id, updates);

      res.json(updatedTarget);
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /api/targets/:id
   * Remove target
   */
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        throw new APIError(400, 'Target ID or name is required');
      }

      // Verify target exists
      const target = await service.getTarget(id);
      if (!target) {
        throw new APIError(404, `Target with ID or name ${id} not found`);
      }

      await service.removeTarget(id);

      res.json({
        success: true,
        message: `Target ${id} removed`,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/targets/:id/test
   * Health check target
   */
  router.post('/:id/test', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        throw new APIError(400, 'Target ID or name is required');
      }

      // Verify target exists
      const target = await service.getTarget(id);
      if (!target) {
        throw new APIError(404, `Target with ID or name ${id} not found`);
      }

      const healthResult = await service.testTargetHealth(id);

      res.json(healthResult);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/targets/:id/spin-up
   * Trigger spin-up for target
   */
  router.post('/:id/spin-up', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        throw new APIError(400, 'Target ID or name is required');
      }

      // Verify target exists
      const target = await service.getTarget(id);
      if (!target) {
        throw new APIError(404, `Target with ID or name ${id} not found`);
      }

      const spinUpResult = await service.triggerTargetSpinUp(id);

      res.json(spinUpResult);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/targets/:id/disable
   * Disable target
   */
  router.post('/:id/disable', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        throw new APIError(400, 'Target ID or name is required');
      }

      // Verify target exists
      const target = await service.getTarget(id);
      if (!target) {
        throw new APIError(404, `Target with ID or name ${id} not found`);
      }

      await service.disableTarget(id);

      res.json({
        success: true,
        message: `Target ${id} disabled`,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/targets/:id/enable
   * Enable target
   */
  router.post('/:id/enable', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!id) {
        throw new APIError(400, 'Target ID or name is required');
      }

      // Verify target exists
      const target = await service.getTarget(id);
      if (!target) {
        throw new APIError(404, `Target with ID or name ${id} not found`);
      }

      await service.enableTarget(id);

      res.json({
        success: true,
        message: `Target ${id} enabled`,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
