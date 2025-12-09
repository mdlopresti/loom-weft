/**
 * Idle Tracker Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IdleTracker } from '../tracker.js';

describe('IdleTracker', () => {
  let tracker: IdleTracker;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (tracker) {
      tracker.shutdown();
    }
    vi.restoreAllMocks();
  });

  describe('recordActivity', () => {
    it('should record agent activity', () => {
      tracker = new IdleTracker();
      tracker.recordActivity('agent-1', 1);

      const lastActivity = tracker.getLastActivity('agent-1');
      expect(lastActivity).toBeDefined();
      expect(lastActivity).toBeInstanceOf(Date);
    });

    it('should update existing agent activity', () => {
      tracker = new IdleTracker();
      tracker.recordActivity('agent-1', 1);

      const firstActivity = tracker.getLastActivity('agent-1');

      vi.advanceTimersByTime(1000);
      tracker.recordActivity('agent-1', 0);

      const secondActivity = tracker.getLastActivity('agent-1');
      expect(secondActivity).not.toEqual(firstActivity);
    });
  });

  describe('removeAgent', () => {
    it('should remove agent from tracking', () => {
      tracker = new IdleTracker();
      tracker.recordActivity('agent-1', 1);

      expect(tracker.getLastActivity('agent-1')).toBeDefined();

      tracker.removeAgent('agent-1');

      expect(tracker.getLastActivity('agent-1')).toBeNull();
    });
  });

  describe('getIdleDuration', () => {
    it('should return idle duration in milliseconds', () => {
      tracker = new IdleTracker();
      tracker.recordActivity('agent-1', 0);

      vi.advanceTimersByTime(60000); // 1 minute

      const duration = tracker.getIdleDuration('agent-1');
      expect(duration).toBe(60000);
    });

    it('should return null for unknown agent', () => {
      tracker = new IdleTracker();

      const duration = tracker.getIdleDuration('unknown');
      expect(duration).toBeNull();
    });
  });

  describe('isIdle', () => {
    it('should return false for agent with active tasks', () => {
      tracker = new IdleTracker({ idleTimeoutMs: 60000 });
      tracker.recordActivity('agent-1', 1);

      vi.advanceTimersByTime(120000); // 2 minutes

      expect(tracker.isIdle('agent-1')).toBe(false);
    });

    it('should return false for agent idle less than timeout', () => {
      tracker = new IdleTracker({ idleTimeoutMs: 300000 }); // 5 minutes
      tracker.recordActivity('agent-1', 0);

      vi.advanceTimersByTime(60000); // 1 minute

      expect(tracker.isIdle('agent-1')).toBe(false);
    });

    it('should return true for agent idle beyond timeout', () => {
      tracker = new IdleTracker({ idleTimeoutMs: 60000 }); // 1 minute
      tracker.recordActivity('agent-1', 0);

      vi.advanceTimersByTime(120000); // 2 minutes

      expect(tracker.isIdle('agent-1')).toBe(true);
    });

    it('should return false for unknown agent', () => {
      tracker = new IdleTracker();

      expect(tracker.isIdle('unknown')).toBe(false);
    });
  });

  describe('getTrackedAgents', () => {
    it('should return list of tracked agents', () => {
      tracker = new IdleTracker();
      tracker.recordActivity('agent-1', 0);
      tracker.recordActivity('agent-2', 1);
      tracker.recordActivity('agent-3', 0);

      const agents = tracker.getTrackedAgents();
      expect(agents).toHaveLength(3);
      expect(agents).toContain('agent-1');
      expect(agents).toContain('agent-2');
      expect(agents).toContain('agent-3');
    });

    it('should return empty array when no agents tracked', () => {
      tracker = new IdleTracker();

      const agents = tracker.getTrackedAgents();
      expect(agents).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      tracker = new IdleTracker({ idleTimeoutMs: 60000 }); // 1 minute

      tracker.recordActivity('agent-1', 0); // Will be idle
      tracker.recordActivity('agent-2', 1); // Active
      tracker.recordActivity('agent-3', 0); // Will be idle

      vi.advanceTimersByTime(120000); // 2 minutes

      const stats = tracker.getStats();
      expect(stats.totalAgents).toBe(3);
      expect(stats.idleAgents).toBe(2);
      expect(stats.activeAgents).toBe(1);
    });
  });

  describe('idle detection and shutdown signals', () => {
    it('should emit idle event when agent becomes idle', () => {
      tracker = new IdleTracker({
        idleTimeoutMs: 60000, // 1 minute
        checkIntervalMs: 30000, // 30 seconds
      });

      const idleEvents: any[] = [];
      tracker.on('idle', (event) => {
        idleEvents.push(event);
      });

      tracker.recordActivity('agent-1', 0);
      tracker.start();

      // Advance past idle timeout
      vi.advanceTimersByTime(90000); // 1.5 minutes

      expect(idleEvents).toHaveLength(1);
      expect(idleEvents[0].agentGuid).toBe('agent-1');
      expect(idleEvents[0].idleDurationMs).toBeGreaterThanOrEqual(60000);
    });

    it('should emit shutdown-signal when agent becomes idle', () => {
      tracker = new IdleTracker({
        idleTimeoutMs: 60000, // 1 minute
        checkIntervalMs: 30000, // 30 seconds
      });

      const shutdownSignals: string[] = [];
      tracker.on('shutdown-signal', (agentGuid) => {
        shutdownSignals.push(agentGuid);
      });

      tracker.recordActivity('agent-1', 0);
      tracker.start();

      // Advance past idle timeout
      vi.advanceTimersByTime(90000); // 1.5 minutes

      expect(shutdownSignals).toHaveLength(1);
      expect(shutdownSignals[0]).toBe('agent-1');
    });

    it('should not emit events for agents with active tasks', () => {
      tracker = new IdleTracker({
        idleTimeoutMs: 60000,
        checkIntervalMs: 30000,
      });

      const shutdownSignals: string[] = [];
      tracker.on('shutdown-signal', (agentGuid) => {
        shutdownSignals.push(agentGuid);
      });

      tracker.recordActivity('agent-1', 1); // Has active task
      tracker.start();

      vi.advanceTimersByTime(90000); // 1.5 minutes

      expect(shutdownSignals).toHaveLength(0);
    });

    it('should remove agent from tracking after shutdown signal', () => {
      tracker = new IdleTracker({
        idleTimeoutMs: 60000,
        checkIntervalMs: 30000,
      });

      tracker.recordActivity('agent-1', 0);
      tracker.start();

      expect(tracker.getTrackedAgents()).toContain('agent-1');

      // Advance past idle timeout
      vi.advanceTimersByTime(90000);

      expect(tracker.getTrackedAgents()).not.toContain('agent-1');
    });

    it('should handle multiple agents with different idle times', () => {
      tracker = new IdleTracker({
        idleTimeoutMs: 60000,
        checkIntervalMs: 30000,
      });

      const shutdownSignals: string[] = [];
      tracker.on('shutdown-signal', (agentGuid) => {
        shutdownSignals.push(agentGuid);
      });

      // Record agent-1 activity at T=0
      tracker.recordActivity('agent-1', 0);

      // Advance 30s, then record agent-2 activity at T=30s
      vi.advanceTimersByTime(30000);
      tracker.recordActivity('agent-2', 0);

      // Start tracker at T=30s
      tracker.start();

      // First check at T=60s (30s after start):
      // - agent-1 idle = 60s (== timeout, triggers shutdown)
      // - agent-2 idle = 30s (< timeout, safe)
      vi.advanceTimersByTime(30000);
      expect(shutdownSignals).toHaveLength(1);
      expect(shutdownSignals[0]).toBe('agent-1');

      // Second check at T=90s:
      // - agent-2 idle = 60s (== timeout, triggers shutdown)
      vi.advanceTimersByTime(30000);
      expect(shutdownSignals).toHaveLength(2);
      expect(shutdownSignals[1]).toBe('agent-2');
    });
  });

  describe('start and stop', () => {
    it('should start checking for idle agents', () => {
      tracker = new IdleTracker({ checkIntervalMs: 30000 });

      tracker.start();

      // Verify interval is set (implementation detail)
      expect(tracker['checkInterval']).toBeDefined();
    });

    it('should stop checking for idle agents', () => {
      tracker = new IdleTracker({ checkIntervalMs: 30000 });

      tracker.start();
      tracker.stop();

      expect(tracker['checkInterval']).toBeNull();
    });

    it('should not start multiple intervals', () => {
      tracker = new IdleTracker({ checkIntervalMs: 30000 });

      tracker.start();
      const firstInterval = tracker['checkInterval'];

      tracker.start();
      const secondInterval = tracker['checkInterval'];

      expect(firstInterval).toBe(secondInterval);
    });
  });

  describe('shutdown', () => {
    it('should clean up all resources', () => {
      tracker = new IdleTracker({ checkIntervalMs: 30000 });

      tracker.recordActivity('agent-1', 0);
      tracker.recordActivity('agent-2', 1);
      tracker.start();

      tracker.shutdown();

      expect(tracker['checkInterval']).toBeNull();
      expect(tracker.getTrackedAgents()).toHaveLength(0);
    });

    it('should remove all event listeners', () => {
      tracker = new IdleTracker();

      const listener = vi.fn();
      tracker.on('idle', listener);
      tracker.on('shutdown-signal', listener);

      tracker.shutdown();

      expect(tracker.listenerCount('idle')).toBe(0);
      expect(tracker.listenerCount('shutdown-signal')).toBe(0);
    });
  });

  describe('custom configuration', () => {
    it('should use custom idle timeout', () => {
      tracker = new IdleTracker({ idleTimeoutMs: 30000 }); // 30 seconds
      tracker.recordActivity('agent-1', 0);

      vi.advanceTimersByTime(40000); // 40 seconds

      expect(tracker.isIdle('agent-1')).toBe(true);
    });

    it('should use custom check interval', () => {
      tracker = new IdleTracker({
        idleTimeoutMs: 60000,
        checkIntervalMs: 10000, // 10 seconds
      });

      const shutdownSignals: string[] = [];
      tracker.on('shutdown-signal', (agentGuid) => {
        shutdownSignals.push(agentGuid);
      });

      tracker.recordActivity('agent-1', 0);
      tracker.start();

      // Should check every 10 seconds
      vi.advanceTimersByTime(10000);
      expect(shutdownSignals).toHaveLength(0); // Not idle yet

      vi.advanceTimersByTime(60000); // Total 70 seconds
      expect(shutdownSignals).toHaveLength(1); // Now idle
    });

    it('should use default configuration when not specified', () => {
      tracker = new IdleTracker();

      expect(tracker['config'].idleTimeoutMs).toBe(300000); // 5 minutes
      expect(tracker['config'].checkIntervalMs).toBe(60000); // 1 minute
    });
  });
});
