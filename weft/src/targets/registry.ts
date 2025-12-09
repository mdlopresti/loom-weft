import type { NatsConnection, KV } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import type {
  SpinUpTarget,
  TargetRegisterRequest,
  TargetUpdateRequest,
  TargetQueryFilter,
  TargetStatus,
  HealthStatus,
} from '@loom/shared';
import { KVBuckets, TargetSubjects } from '@loom/shared';

/**
 * Dynamic target registry
 *
 * Provides CRUD operations for spin-up targets backed by NATS KV.
 * Publishes events when targets are registered, updated, or removed.
 */
export class TargetRegistry {
  private kv: KV | null = null;

  constructor(
    private nc: NatsConnection,
    private projectId: string
  ) {}

  /**
   * Initialize the registry (create KV bucket if needed)
   */
  async initialize(): Promise<void> {
    const js = this.nc.jetstream();
    const bucketName = KVBuckets.targetRegistry(this.projectId);

    try {
      this.kv = await js.views.kv(bucketName);
    } catch (error) {
      // Bucket doesn't exist, create it
      this.kv = await js.views.kv(bucketName, {
        history: 10,
        ttl: 0, // No TTL - targets persist until explicitly removed
      });
    }
  }

  /**
   * Register a new spin-up target
   */
  async registerTarget(request: TargetRegisterRequest): Promise<SpinUpTarget> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    // Check if name already exists
    const existing = await this.getTargetByName(request.name);
    if (existing) {
      throw new Error(`Target with name '${request.name}' already exists`);
    }

    // Create target
    const now = new Date().toISOString();
    const target: SpinUpTarget = {
      id: uuidv4(),
      name: request.name,
      description: request.description,
      agentType: request.agentType,
      capabilities: request.capabilities,
      boundaries: request.boundaries ?? [
        'corporate',
        'corporate-adjacent',
        'personal',
        'open-source',
      ],
      mechanism: request.mechanism,
      config: request.config,
      status: 'available',
      healthCheck: request.healthCheck
        ? {
            enabled: request.healthCheck.enabled,
            intervalMs: request.healthCheck.intervalMs ?? 300000, // 5 minutes
            timeoutMs: request.healthCheck.timeoutMs ?? 10000, // 10 seconds
          }
        : undefined,
      healthStatus: 'unknown',
      registeredBy: 'api', // Default, can be overridden by caller
      registeredAt: now,
      updatedAt: now,
      useCount: 0,
      tags: request.tags,
    };

    // Store in KV
    await this.kv.put(target.id, JSON.stringify(target));

    // Publish registration event
    await this.publishEvent('register', target);

    return target;
  }

  /**
   * Update an existing target
   */
  async updateTarget(request: TargetUpdateRequest): Promise<SpinUpTarget> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    // Find target
    const target = await this.getTarget(request.target);
    if (!target) {
      throw new Error(`Target '${request.target}' not found`);
    }

    // Apply updates
    if (request.updates.description !== undefined) {
      target.description = request.updates.description;
    }
    if (request.updates.capabilities !== undefined) {
      target.capabilities = request.updates.capabilities;
    }
    if (request.updates.boundaries !== undefined) {
      target.boundaries = request.updates.boundaries;
    }
    if (request.updates.config !== undefined) {
      // Merge config
      target.config = {
        ...target.config,
        ...request.updates.config,
      } as typeof target.config;
    }
    if (request.updates.healthCheck !== undefined) {
      if (target.healthCheck) {
        target.healthCheck = {
          ...target.healthCheck,
          ...request.updates.healthCheck,
        };
      } else if (request.updates.healthCheck.enabled !== undefined) {
        target.healthCheck = {
          enabled: request.updates.healthCheck.enabled,
          intervalMs: request.updates.healthCheck.intervalMs ?? 300000,
          timeoutMs: request.updates.healthCheck.timeoutMs ?? 10000,
        };
      }
    }
    if (request.updates.tags !== undefined) {
      target.tags = request.updates.tags;
    }

    target.updatedAt = new Date().toISOString();

    // Store updated target
    await this.kv.put(target.id, JSON.stringify(target));

    // Publish update event
    await this.publishEvent('update', target);

    return target;
  }

  /**
   * Remove a target
   */
  async removeTarget(targetId: string): Promise<void> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    // Get target before removing (for event)
    const target = await this.getTarget(targetId);
    if (!target) {
      throw new Error(`Target '${targetId}' not found`);
    }

    // Remove from KV
    await this.kv.delete(targetId);

    // Publish removal event
    await this.publishEvent('remove', target);
  }

  /**
   * Get a target by ID or name
   */
  async getTarget(targetIdOrName: string): Promise<SpinUpTarget | null> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    // Try as ID first
    try {
      const entry = await this.kv.get(targetIdOrName);
      if (entry) {
        return JSON.parse(entry.string()) as SpinUpTarget;
      }
    } catch (error) {
      // Not found as ID, try as name
    }

    // Try as name
    return await this.getTargetByName(targetIdOrName);
  }

  /**
   * Get a target by name
   */
  private async getTargetByName(name: string): Promise<SpinUpTarget | null> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    // Collect all keys first to ensure iterator is fully consumed
    const keys: string[] = [];
    const iter = await this.kv.keys();
    for await (const key of iter) {
      keys.push(key);
    }

    // Scan all targets to find by name
    for (const key of keys) {
      const entry = await this.kv.get(key);
      if (entry) {
        const target = JSON.parse(entry.string()) as SpinUpTarget;
        if (target.name === name) {
          return target;
        }
      }
    }

    return null;
  }

  /**
   * Query targets with filters
   */
  async queryTargets(filter: TargetQueryFilter = {}): Promise<SpinUpTarget[]> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    const results: SpinUpTarget[] = [];

    // Collect all keys first to ensure iterator is fully consumed
    // This avoids race conditions with async iterators
    const keys: string[] = [];
    const iter = await this.kv.keys();
    for await (const key of iter) {
      keys.push(key);
    }

    // Now fetch and filter each target
    for (const key of keys) {
      const entry = await this.kv.get(key);
      if (entry) {
        const target = JSON.parse(entry.string()) as SpinUpTarget;

        // Apply filters
        if (filter.agentType && target.agentType !== filter.agentType) {
          continue;
        }
        if (filter.capability && !target.capabilities.includes(filter.capability)) {
          continue;
        }
        if (
          filter.boundary &&
          !target.boundaries.includes(filter.boundary)
        ) {
          continue;
        }
        if (filter.status && target.status !== filter.status) {
          continue;
        }
        if (filter.healthStatus && target.healthStatus !== filter.healthStatus) {
          continue;
        }
        if (filter.mechanism && target.mechanism !== filter.mechanism) {
          continue;
        }
        if (filter.tag && (!target.tags || !target.tags.includes(filter.tag))) {
          continue;
        }
        if (!filter.includeDisabled && target.status === 'disabled') {
          continue;
        }

        results.push(target);
      }
    }

    return results;
  }

  /**
   * Link an agent to its target
   */
  async linkAgentToTarget(agentGuid: string, targetName: string): Promise<void> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    const target = await this.getTargetByName(targetName);
    if (!target) {
      throw new Error(`Target '${targetName}' not found`);
    }

    // Update target
    target.currentAgentGuid = agentGuid;
    target.status = 'in-use';
    target.lastUsedAt = new Date().toISOString();
    target.useCount++;
    target.updatedAt = new Date().toISOString();

    await this.kv.put(target.id, JSON.stringify(target));

    // Publish update event
    await this.publishEvent('update', target);
  }

  /**
   * Unlink an agent from its target
   */
  async unlinkAgentFromTarget(agentGuid: string): Promise<void> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    // Find target with this agent
    const targets = await this.queryTargets({});
    const target = targets.find((t) => t.currentAgentGuid === agentGuid);

    if (target) {
      target.currentAgentGuid = undefined;
      target.status = 'available';
      target.updatedAt = new Date().toISOString();

      await this.kv.put(target.id, JSON.stringify(target));

      // Publish update event
      await this.publishEvent('update', target);
    }
  }

  /**
   * Update target status
   */
  async updateTargetStatus(
    targetId: string,
    status: TargetStatus,
    error?: string
  ): Promise<void> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    const target = await this.getTarget(targetId);
    if (!target) {
      throw new Error(`Target '${targetId}' not found`);
    }

    target.status = status;
    if (error) {
      target.lastError = error;
    } else {
      target.lastError = undefined;
    }
    target.updatedAt = new Date().toISOString();

    await this.kv.put(target.id, JSON.stringify(target));

    // Publish update event
    await this.publishEvent('update', target);
  }

  /**
   * Update target health status
   */
  async updateTargetHealth(
    targetId: string,
    healthStatus: HealthStatus,
    error?: string
  ): Promise<void> {
    if (!this.kv) {
      throw new Error('TargetRegistry not initialized');
    }

    const target = await this.getTarget(targetId);
    if (!target) {
      throw new Error(`Target '${targetId}' not found`);
    }

    target.healthStatus = healthStatus;
    target.lastHealthCheck = new Date().toISOString();
    if (error && healthStatus === 'unhealthy') {
      target.lastError = error;
    }
    target.updatedAt = new Date().toISOString();

    await this.kv.put(target.id, JSON.stringify(target));

    // Publish health event
    const subject = TargetSubjects.health(this.projectId, target.id);
    await this.nc.publish(
      subject,
      JSON.stringify({
        targetId: target.id,
        targetName: target.name,
        healthStatus,
        error,
        timestamp: target.lastHealthCheck,
      })
    );
  }

  /**
   * Publish a target event
   */
  private async publishEvent(
    eventType: 'register' | 'update' | 'remove',
    target: SpinUpTarget
  ): Promise<void> {
    const subject =
      eventType === 'register'
        ? TargetSubjects.register(this.projectId)
        : eventType === 'update'
          ? TargetSubjects.update(this.projectId)
          : TargetSubjects.remove(this.projectId);

    await this.nc.publish(subject, JSON.stringify(target));
  }

  /**
   * Get all targets (no filtering)
   */
  async getAllTargets(): Promise<SpinUpTarget[]> {
    return await this.queryTargets({});
  }

  /**
   * Close the registry
   */
  async close(): Promise<void> {
    // KV doesn't need explicit closing
    this.kv = null;
  }
}
