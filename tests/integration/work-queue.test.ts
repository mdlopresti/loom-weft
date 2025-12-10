/**
 * End-to-end integration tests for work queue operations
 *
 * These tests require a running NATS server with JetStream enabled.
 * Run with: NATS_URL=nats://localhost:4222 npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connect, NatsConnection, JetStreamClient, JetStreamManager, StringCodec } from 'nats';
import { v4 as uuidv4 } from 'uuid';

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === 'true';

const sc = StringCodec();

describe.skipIf(!RUN_INTEGRATION)('Work Queue Integration', () => {
  let nc: NatsConnection;
  let js: JetStreamClient;
  let jsm: JetStreamManager;
  const projectId = `test-${Date.now()}`;
  const streamName = `LOOM_WORK_${projectId.replace(/-/g, '_').toUpperCase()}`;

  beforeAll(async () => {
    nc = await connect({ servers: NATS_URL });
    js = nc.jetstream();
    jsm = await nc.jetstreamManager();

    // Create work stream
    try {
      await jsm.streams.add({
        name: streamName,
        subjects: [`loom.${projectId}.work.>`],
        retention: 'workqueue',
        max_msgs: 10000,
        max_age: 3600000000000, // 1 hour in nanoseconds
      });
    } catch (e: any) {
      if (!e.message?.includes('already in use')) {
        throw e;
      }
    }
  });

  afterAll(async () => {
    // Cleanup stream
    try {
      await jsm.streams.delete(streamName);
    } catch {
      // Stream may not exist
    }
    await nc.drain();
  });

  describe('Work Submission', () => {
    it('should publish work to capability queue', async () => {
      const workItem = {
        id: uuidv4(),
        taskId: 'test-task-1',
        description: 'Test work item',
        capability: 'typescript',
        boundary: 'personal',
        priority: 5,
        submittedAt: new Date().toISOString(),
      };

      const subject = `loom.${projectId}.work.queue.typescript`;
      const ack = await js.publish(subject, sc.encode(JSON.stringify(workItem)));

      expect(ack.seq).toBeGreaterThan(0);
      expect(ack.stream).toBe(streamName);
    });

    it('should publish work with different priorities', async () => {
      const workItems = [
        { id: uuidv4(), priority: 3, description: 'Low priority' },
        { id: uuidv4(), priority: 7, description: 'High priority' },
        { id: uuidv4(), priority: 5, description: 'Normal priority' },
      ];

      for (const item of workItems) {
        const subject = `loom.${projectId}.work.queue.general`;
        await js.publish(subject, sc.encode(JSON.stringify(item)));
      }

      // All should be published
      const info = await jsm.streams.info(streamName);
      expect(info.state.messages).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Work Claiming', () => {
    it('should create consumer for capability', async () => {
      const capability = 'python';
      const consumerName = `worker-${capability}-${Date.now()}`;

      // Add a consumer for the capability
      const consumer = await jsm.consumers.add(streamName, {
        durable_name: consumerName,
        filter_subject: `loom.${projectId}.work.queue.${capability}`,
        ack_policy: 'explicit',
        max_deliver: 3,
      });

      expect(consumer.name).toBe(consumerName);

      // Cleanup
      await jsm.consumers.delete(streamName, consumerName);
    });

    it('should allow competing consumers', async () => {
      const capability = 'shared-work';
      const consumerName = `shared-worker-${Date.now()}`;
      const subject = `loom.${projectId}.work.queue.${capability}`;

      // Create shared consumer
      await jsm.consumers.add(streamName, {
        durable_name: consumerName,
        filter_subject: subject,
        ack_policy: 'explicit',
      });

      // Publish multiple work items
      for (let i = 0; i < 5; i++) {
        await js.publish(subject, sc.encode(JSON.stringify({
          id: uuidv4(),
          taskId: `task-${i}`,
        })));
      }

      // Get consumer and fetch messages
      const consumer = await js.consumers.get(streamName, consumerName);
      const messages = await consumer.fetch({ max_messages: 5, expires: 1000 });

      let count = 0;
      for await (const msg of messages) {
        count++;
        msg.ack();
      }

      expect(count).toBe(5);

      // Cleanup
      await jsm.consumers.delete(streamName, consumerName);
    });
  });

  describe('Work Completion', () => {
    it('should publish completion events', async () => {
      const workItemId = uuidv4();
      const completionSubject = `loom.${projectId}.work.completed`;

      // Subscribe to completions
      const completions: any[] = [];
      const sub = nc.subscribe(completionSubject, {
        callback: (err, msg) => {
          if (!err) {
            completions.push(JSON.parse(sc.decode(msg.data)));
          }
        },
      });

      // Simulate work completion
      nc.publish(completionSubject, sc.encode(JSON.stringify({
        workItemId,
        taskId: 'completed-task',
        agentGuid: uuidv4(),
        result: {
          summary: 'Work completed successfully',
          completedAt: new Date().toISOString(),
        },
      })));

      // Wait for message
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(completions).toHaveLength(1);
      expect(completions[0].workItemId).toBe(workItemId);

      sub.unsubscribe();
    });

    it('should publish error events', async () => {
      const workItemId = uuidv4();
      const errorSubject = `loom.${projectId}.work.errors`;

      const errors: any[] = [];
      const sub = nc.subscribe(errorSubject, {
        callback: (err, msg) => {
          if (!err) {
            errors.push(JSON.parse(sc.decode(msg.data)));
          }
        },
      });

      // Simulate work error
      nc.publish(errorSubject, sc.encode(JSON.stringify({
        workItemId,
        taskId: 'failed-task',
        agentGuid: uuidv4(),
        error: {
          message: 'Task failed due to timeout',
          recoverable: true,
          occurredAt: new Date().toISOString(),
        },
      })));

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toContain('timeout');

      sub.unsubscribe();
    });
  });

  describe('Stream Operations', () => {
    it('should get stream info', async () => {
      const info = await jsm.streams.info(streamName);

      expect(info.config.name).toBe(streamName);
      expect(info.config.retention).toBe('workqueue');
    });

    it('should purge stream', async () => {
      // Add some messages
      for (let i = 0; i < 3; i++) {
        await js.publish(
          `loom.${projectId}.work.queue.cleanup`,
          sc.encode(JSON.stringify({ id: uuidv4() }))
        );
      }

      // Purge
      await jsm.streams.purge(streamName);

      const info = await jsm.streams.info(streamName);
      expect(info.state.messages).toBe(0);
    });
  });
});
