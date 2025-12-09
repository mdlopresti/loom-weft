import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connect, type NatsConnection } from 'nats';
import { TargetRegistry } from '../registry.js';
import type { TargetRegisterRequest, SpinUpTarget } from '@loom/shared';

describe('TargetRegistry', () => {
  let nc: NatsConnection;
  let registry: TargetRegistry;
  let projectId: string;

  beforeEach(async () => {
    // Use unique project ID per test for isolation
    projectId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Connect to NATS (assumes NATS is running on localhost:4222)
    nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
    registry = new TargetRegistry(nc, projectId);
    await registry.initialize();
  });

  afterEach(async () => {
    // Clean up - delete the KV bucket
    try {
      const js = nc.jetstream();
      const bucketName = `coord-targets-${projectId}`;
      await js.views.kv(bucketName).then(kv => kv.destroy());
    } catch {
      // Ignore cleanup errors
    }
    await registry.close();
    await nc.close();
  });

  describe('registerTarget', () => {
    it('should register a new target', async () => {
      const request: TargetRegisterRequest = {
        name: 'test-target',
        description: 'A test target',
        agentType: 'claude-code',
        capabilities: ['typescript', 'python'],
        boundaries: ['personal', 'open-source'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: {
            command: 'claude',
            args: ['--project', '/test'],
          },
        },
      };

      const target = await registry.registerTarget(request);

      expect(target.id).toBeTruthy();
      expect(target.name).toBe('test-target');
      expect(target.agentType).toBe('claude-code');
      expect(target.status).toBe('available');
      expect(target.healthStatus).toBe('unknown');
      expect(target.useCount).toBe(0);
    });

    it('should reject duplicate names', async () => {
      const request: TargetRegisterRequest = {
        name: 'duplicate',
        agentType: 'claude-code',
        capabilities: ['typescript'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: {
            command: 'claude',
          },
        },
      };

      await registry.registerTarget(request);

      await expect(registry.registerTarget(request)).rejects.toThrow(
        "Target with name 'duplicate' already exists"
      );
    });

    it('should set default allowed classifications if not provided', async () => {
      const request: TargetRegisterRequest = {
        name: 'default-classifications',
        agentType: 'claude-code',
        capabilities: ['typescript'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: {
            command: 'claude',
          },
        },
      };

      const target = await registry.registerTarget(request);

      expect(target.boundaries).toEqual([
        'corporate',
        'corporate-adjacent',
        'personal',
        'open-source',
      ]);
    });
  });

  describe('getTarget', () => {
    let target: SpinUpTarget;

    beforeEach(async () => {
      const request: TargetRegisterRequest = {
        name: 'get-target-test',
        agentType: 'claude-code',
        capabilities: ['typescript'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: {
            command: 'claude',
          },
        },
      };
      target = await registry.registerTarget(request);
    });

    it('should get target by ID', async () => {
      const retrieved = await registry.getTarget(target.id);
      expect(retrieved).toEqual(target);
    });

    it('should get target by name', async () => {
      const retrieved = await registry.getTarget('get-target-test');
      expect(retrieved).toEqual(target);
    });

    it('should return null for non-existent target', async () => {
      const retrieved = await registry.getTarget('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('updateTarget', () => {
    let target: SpinUpTarget;

    beforeEach(async () => {
      const request: TargetRegisterRequest = {
        name: 'update-target-test',
        agentType: 'claude-code',
        capabilities: ['typescript'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: {
            command: 'claude',
          },
        },
      };
      target = await registry.registerTarget(request);
    });

    it('should update target description', async () => {
      const updated = await registry.updateTarget({
        target: target.id,
        updates: {
          description: 'Updated description',
        },
      });

      expect(updated.description).toBe('Updated description');
    });

    it('should update target capabilities', async () => {
      const updated = await registry.updateTarget({
        target: target.id,
        updates: {
          capabilities: ['typescript', 'python', 'go'],
        },
      });

      expect(updated.capabilities).toEqual(['typescript', 'python', 'go']);
    });

    it('should update target by name', async () => {
      const updated = await registry.updateTarget({
        target: 'update-target-test',
        updates: {
          description: 'Updated via name',
        },
      });

      expect(updated.description).toBe('Updated via name');
    });

    it('should reject update of non-existent target', async () => {
      await expect(
        registry.updateTarget({
          target: 'non-existent',
          updates: {
            description: 'Test',
          },
        })
      ).rejects.toThrow("Target 'non-existent' not found");
    });
  });

  describe('removeTarget', () => {
    it('should remove a target', async () => {
      const request: TargetRegisterRequest = {
        name: 'remove-target-test',
        agentType: 'claude-code',
        capabilities: ['typescript'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: {
            command: 'claude',
          },
        },
      };
      const target = await registry.registerTarget(request);

      await registry.removeTarget(target.id);

      const retrieved = await registry.getTarget(target.id);
      expect(retrieved).toBeNull();
    });

    it('should reject removal of non-existent target', async () => {
      await expect(registry.removeTarget('non-existent')).rejects.toThrow(
        "Target 'non-existent' not found"
      );
    });
  });

  describe('queryTargets', () => {
    beforeEach(async () => {
      // Create multiple targets for query tests
      await registry.registerTarget({
        name: 'claude-ts',
        agentType: 'claude-code',
        capabilities: ['typescript'],
        boundaries: ['personal'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: { command: 'claude' },
        },
      });

      await registry.registerTarget({
        name: 'claude-py',
        agentType: 'claude-code',
        capabilities: ['python'],
        boundaries: ['personal', 'open-source'],
        mechanism: 'ssh',
        config: {
          mechanism: 'ssh',
          ssh: {
            host: 'example.com',
            user: 'test',
            command: 'claude',
          },
        },
      });

      await registry.registerTarget({
        name: 'copilot-ts',
        agentType: 'copilot-cli',
        capabilities: ['typescript'],
        boundaries: ['corporate'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: { command: 'copilot' },
        },
      });
    });

    it('should query by agent type', async () => {
      const results = await registry.queryTargets({ agentType: 'claude-code' });
      expect(results).toHaveLength(2);
      expect(results.every((t) => t.agentType === 'claude-code')).toBe(true);
    });

    it('should query by capability', async () => {
      const results = await registry.queryTargets({ capability: 'typescript' });
      expect(results).toHaveLength(2);
      expect(results.every((t) => t.capabilities.includes('typescript'))).toBe(true);
    });

    it('should query by classification', async () => {
      const results = await registry.queryTargets({ boundary: 'personal' });
      expect(results).toHaveLength(2);
      expect(
        results.every((t) => t.boundaries.includes('personal'))
      ).toBe(true);
    });

    it('should query by mechanism', async () => {
      const results = await registry.queryTargets({ mechanism: 'local' });
      expect(results).toHaveLength(2);
      expect(results.every((t) => t.mechanism === 'local')).toBe(true);
    });

    it('should combine multiple filters', async () => {
      const results = await registry.queryTargets({
        agentType: 'claude-code',
        capability: 'python',
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('claude-py');
    });
  });

  describe('linkAgentToTarget', () => {
    let target: SpinUpTarget;

    beforeEach(async () => {
      const request: TargetRegisterRequest = {
        name: 'link-target-test',
        agentType: 'claude-code',
        capabilities: ['typescript'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: {
            command: 'claude',
          },
        },
      };
      target = await registry.registerTarget(request);
    });

    it('should link agent to target', async () => {
      const agentGuid = 'test-agent-guid';

      await registry.linkAgentToTarget(agentGuid, target.name);

      const updated = await registry.getTarget(target.id);
      expect(updated?.currentAgentGuid).toBe(agentGuid);
      expect(updated?.status).toBe('in-use');
      expect(updated?.useCount).toBe(1);
      expect(updated?.lastUsedAt).toBeTruthy();
    });

    it('should increment use count on multiple links', async () => {
      await registry.linkAgentToTarget('agent-1', target.name);
      await registry.unlinkAgentFromTarget('agent-1');
      await registry.linkAgentToTarget('agent-2', target.name);

      const updated = await registry.getTarget(target.id);
      expect(updated?.useCount).toBe(2);
    });
  });

  describe('unlinkAgentFromTarget', () => {
    let target: SpinUpTarget;
    const agentGuid = 'test-agent-guid';

    beforeEach(async () => {
      const request: TargetRegisterRequest = {
        name: 'unlink-target-test',
        agentType: 'claude-code',
        capabilities: ['typescript'],
        mechanism: 'local',
        config: {
          mechanism: 'local',
          local: {
            command: 'claude',
          },
        },
      };
      target = await registry.registerTarget(request);
      await registry.linkAgentToTarget(agentGuid, target.name);
    });

    it('should unlink agent from target', async () => {
      await registry.unlinkAgentFromTarget(agentGuid);

      const updated = await registry.getTarget(target.id);
      expect(updated?.currentAgentGuid).toBeUndefined();
      expect(updated?.status).toBe('available');
    });

    it('should handle unlinking non-existent agent gracefully', async () => {
      await expect(
        registry.unlinkAgentFromTarget('non-existent-agent')
      ).resolves.not.toThrow();
    });
  });
});
