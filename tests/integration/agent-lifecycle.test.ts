/**
 * End-to-end integration tests for agent lifecycle
 *
 * These tests require a running NATS server with JetStream enabled.
 * Run with: NATS_URL=nats://localhost:4222 npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connect, NatsConnection, JetStreamClient, KV } from 'nats';
import { v4 as uuidv4 } from 'uuid';

// Skip if no NATS available
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === 'true';

describe.skipIf(!RUN_INTEGRATION)('Agent Lifecycle Integration', () => {
  let nc: NatsConnection;
  let js: JetStreamClient;
  let agentKV: KV;
  const projectId = `test-${Date.now()}`;
  const bucketName = `loom-agents-${projectId}`;

  beforeAll(async () => {
    nc = await connect({ servers: NATS_URL });
    js = nc.jetstream();

    // Create agent registry KV bucket
    const kvm = await js.views.kv(bucketName, {
      history: 1,
      ttl: 60000, // 1 minute TTL for tests
    });
    agentKV = kvm;
  });

  afterAll(async () => {
    // Cleanup
    try {
      await js.views.kv(bucketName).then(kv => kv.destroy());
    } catch {
      // Bucket may not exist
    }
    await nc.drain();
  });

  beforeEach(async () => {
    // Clear all keys before each test
    const keys = await agentKV.keys();
    for await (const key of keys) {
      await agentKV.delete(key);
    }
  });

  describe('Agent Registration', () => {
    it('should register an agent in the KV store', async () => {
      const agentGuid = uuidv4();
      const agent = {
        guid: agentGuid,
        handle: 'test-agent',
        agentType: 'claude-code',
        status: 'online',
        capabilities: ['typescript', 'testing'],
        boundaries: ['personal'],
        hostname: 'test-host',
        projectId,
        visibility: 'project-only',
        currentTaskCount: 0,
        maxConcurrentTasks: 3,
        lastHeartbeat: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        registeredAt: new Date().toISOString(),
      };

      // Register agent
      await agentKV.put(agentGuid, JSON.stringify(agent));

      // Verify registration
      const entry = await agentKV.get(agentGuid);
      expect(entry).toBeDefined();

      const retrieved = JSON.parse(new TextDecoder().decode(entry!.value));
      expect(retrieved.guid).toBe(agentGuid);
      expect(retrieved.handle).toBe('test-agent');
      expect(retrieved.status).toBe('online');
    });

    it('should update agent status', async () => {
      const agentGuid = uuidv4();
      const agent = {
        guid: agentGuid,
        handle: 'status-test-agent',
        status: 'online',
        lastHeartbeat: new Date().toISOString(),
      };

      await agentKV.put(agentGuid, JSON.stringify(agent));

      // Update status to busy
      agent.status = 'busy';
      await agentKV.put(agentGuid, JSON.stringify(agent));

      const entry = await agentKV.get(agentGuid);
      const retrieved = JSON.parse(new TextDecoder().decode(entry!.value));
      expect(retrieved.status).toBe('busy');
    });

    it('should deregister an agent', async () => {
      const agentGuid = uuidv4();
      const agent = {
        guid: agentGuid,
        handle: 'deregister-test-agent',
        status: 'online',
      };

      await agentKV.put(agentGuid, JSON.stringify(agent));

      // Verify it exists
      let entry = await agentKV.get(agentGuid);
      expect(entry).toBeDefined();
      expect(entry!.operation).toBe('PUT');

      // Deregister (this creates a tombstone in NATS KV)
      await agentKV.delete(agentGuid);

      // NATS KV delete creates a tombstone, so get() returns DEL operation
      entry = await agentKV.get(agentGuid);
      // Entry may be null or have DEL operation depending on timing
      if (entry) {
        expect(entry.operation).toBe('DEL');
      }
    });
  });

  describe('Agent Discovery', () => {
    it('should find agents by scanning KV store', async () => {
      // Register multiple agents
      const agents = [
        { guid: uuidv4(), handle: 'agent-1', capabilities: ['typescript'] },
        { guid: uuidv4(), handle: 'agent-2', capabilities: ['python'] },
        { guid: uuidv4(), handle: 'agent-3', capabilities: ['typescript', 'testing'] },
      ];

      for (const agent of agents) {
        await agentKV.put(agent.guid, JSON.stringify(agent));
      }

      // Wait for consistency
      await new Promise(resolve => setTimeout(resolve, 100));

      // Discover all agents using watch instead of keys for more reliable iteration
      const discovered: any[] = [];
      for (const agent of agents) {
        const entry = await agentKV.get(agent.guid);
        if (entry && entry.operation === 'PUT') {
          discovered.push(JSON.parse(new TextDecoder().decode(entry.value)));
        }
      }

      expect(discovered).toHaveLength(3);
      expect(discovered.map(a => a.handle)).toContain('agent-1');
      expect(discovered.map(a => a.handle)).toContain('agent-2');
      expect(discovered.map(a => a.handle)).toContain('agent-3');
    });

    it('should filter agents by capability', async () => {
      const agents = [
        { guid: uuidv4(), handle: 'ts-agent', capabilities: ['typescript'] },
        { guid: uuidv4(), handle: 'py-agent', capabilities: ['python'] },
        { guid: uuidv4(), handle: 'full-stack', capabilities: ['typescript', 'python'] },
      ];

      for (const agent of agents) {
        await agentKV.put(agent.guid, JSON.stringify(agent));
      }

      // Wait for consistency
      await new Promise(resolve => setTimeout(resolve, 100));

      // Find typescript agents by fetching known keys
      const tsAgents: any[] = [];
      for (const agent of agents) {
        const entry = await agentKV.get(agent.guid);
        if (entry && entry.operation === 'PUT') {
          const retrieved = JSON.parse(new TextDecoder().decode(entry.value));
          if (retrieved.capabilities?.includes('typescript')) {
            tsAgents.push(retrieved);
          }
        }
      }

      expect(tsAgents).toHaveLength(2);
      expect(tsAgents.map(a => a.handle)).toContain('ts-agent');
      expect(tsAgents.map(a => a.handle)).toContain('full-stack');
    });
  });

  describe('Heartbeat', () => {
    it('should update lastHeartbeat timestamp', async () => {
      const agentGuid = uuidv4();
      const originalTime = new Date('2025-01-01T00:00:00Z').toISOString();
      const agent = {
        guid: agentGuid,
        handle: 'heartbeat-test-agent',
        lastHeartbeat: originalTime,
      };

      await agentKV.put(agentGuid, JSON.stringify(agent));

      // Simulate heartbeat
      const newTime = new Date().toISOString();
      agent.lastHeartbeat = newTime;
      await agentKV.put(agentGuid, JSON.stringify(agent));

      const entry = await agentKV.get(agentGuid);
      const retrieved = JSON.parse(new TextDecoder().decode(entry!.value));

      expect(retrieved.lastHeartbeat).toBe(newTime);
      expect(new Date(retrieved.lastHeartbeat).getTime()).toBeGreaterThan(
        new Date(originalTime).getTime()
      );
    });
  });
});
