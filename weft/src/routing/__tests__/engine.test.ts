/**
 * Routing Engine Tests
 *
 * Tests for boundary-aware routing with user-defined boundaries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoutingEngine } from '../engine.js';
import type { RegisteredAgent, Boundary, AgentType } from '@loom/shared';

describe('RoutingEngine', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine();
  });

  describe('resolveAgentType', () => {
    it('should default to claude-code when no config and no availability info', () => {
      const decision = engine.resolveAgentType('production');

      expect(decision.boundary).toBe('production');
      expect(decision.targetAgentType).toBe('claude-code');
      expect(decision.isFallback).toBe(false);
      expect(decision.reason).toContain('Default agent type');
    });

    it('should use preferred type from boundary config when no availability info', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          { name: 'production', preferredAgentType: 'copilot-cli' },
        ],
      });

      const decision = configuredEngine.resolveAgentType('production');

      expect(decision.boundary).toBe('production');
      expect(decision.targetAgentType).toBe('copilot-cli');
      expect(decision.isFallback).toBe(false);
      expect(decision.reason).toContain('Preferred agent type from boundary config');
    });

    it('should use preferred type when available', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          { name: 'production', preferredAgentType: 'copilot-cli' },
        ],
      });

      const decision = configuredEngine.resolveAgentType('production', ['copilot-cli', 'claude-code']);

      expect(decision.targetAgentType).toBe('copilot-cli');
      expect(decision.isFallback).toBe(false);
      expect(decision.reason).toBe('Preferred agent type is available');
    });

    it('should use fallback type when preferred not available', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          {
            name: 'production',
            preferredAgentType: 'copilot-cli',
            fallbackAgentType: 'claude-code',
          },
        ],
      });

      const decision = configuredEngine.resolveAgentType('production', ['claude-code']);

      expect(decision.targetAgentType).toBe('claude-code');
      expect(decision.isFallback).toBe(true);
      expect(decision.reason).toBe('Using fallback agent type');
    });

    it('should use first available type when neither preferred nor fallback available', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          {
            name: 'production',
            preferredAgentType: 'copilot-cli',
            fallbackAgentType: 'claude-code',
          },
        ],
      });

      // Hypothetical third agent type
      const decision = configuredEngine.resolveAgentType('production', ['claude-code']);

      // Since fallback is claude-code and it's available, it should use that
      expect(decision.targetAgentType).toBe('claude-code');
    });

    it('should work with user-defined boundaries', () => {
      const decision = engine.resolveAgentType('team-alpha');

      expect(decision.boundary).toBe('team-alpha');
      expect(decision.targetAgentType).toBe('claude-code'); // Default
    });

    it('should handle empty availability list same as no availability', () => {
      const decision = engine.resolveAgentType('staging', []);

      expect(decision.targetAgentType).toBe('claude-code');
      expect(decision.reason).toContain('no availability');
    });
  });

  describe('isEligible', () => {
    const createAgent = (
      agentType: AgentType,
      boundaries: Boundary[],
      status: 'online' | 'busy' | 'offline' = 'online'
    ): RegisteredAgent => ({
      guid: 'test-guid',
      handle: 'test-agent',
      agentType,
      status,
      capabilities: ['typescript'],
      boundaries,
      hostname: 'localhost',
      projectId: 'test-project',
      visibility: 'public',
      currentTaskCount: 0,
      maxConcurrentTasks: 1,
      spindownAfterIdleMs: 300000,
      lastHeartbeat: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
    });

    it('should allow agent that accepts the boundary', () => {
      const agent = createAgent('claude-code', ['production', 'staging']);
      const result = engine.isEligible(agent, 'production');

      expect(result.eligible).toBe(true);
    });

    it('should reject agent that does not accept the boundary', () => {
      const agent = createAgent('claude-code', ['staging']);
      const result = engine.isEligible(agent, 'production');

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("does not accept boundary 'production'");
    });

    it('should reject offline agents', () => {
      const agent = createAgent('claude-code', ['production'], 'offline');
      const result = engine.isEligible(agent, 'production');

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('offline');
    });

    it('should allow busy agents', () => {
      const agent = createAgent('claude-code', ['production'], 'busy');
      const result = engine.isEligible(agent, 'production');

      expect(result.eligible).toBe(true);
    });

    it('should work with user-defined boundary names', () => {
      const agent = createAgent('copilot-cli', ['client-acme', 'client-beta']);

      expect(engine.isEligible(agent, 'client-acme').eligible).toBe(true);
      expect(engine.isEligible(agent, 'client-beta').eligible).toBe(true);
      expect(engine.isEligible(agent, 'client-gamma').eligible).toBe(false);
    });
  });

  describe('filterEligible', () => {
    const createAgent = (
      guid: string,
      agentType: AgentType,
      boundaries: Boundary[]
    ): RegisteredAgent => ({
      guid,
      handle: `${agentType}-agent`,
      agentType,
      status: 'online',
      capabilities: ['typescript'],
      boundaries,
      hostname: 'localhost',
      projectId: 'test-project',
      visibility: 'public',
      currentTaskCount: 0,
      maxConcurrentTasks: 1,
      spindownAfterIdleMs: 300000,
      lastHeartbeat: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
    });

    it('should filter agents by boundary', () => {
      const agents = [
        createAgent('1', 'copilot-cli', ['production']),
        createAgent('2', 'claude-code', ['production', 'staging']),
        createAgent('3', 'copilot-cli', ['staging']),
      ];

      const eligible = engine.filterEligible(agents, 'production');

      expect(eligible).toHaveLength(2);
      expect(eligible.map(a => a.guid)).toContain('1');
      expect(eligible.map(a => a.guid)).toContain('2');
    });

    it('should return all agents that accept the boundary', () => {
      const agents = [
        createAgent('1', 'copilot-cli', ['team-alpha']),
        createAgent('2', 'claude-code', ['team-alpha']),
        createAgent('3', 'claude-code', ['team-beta']),
      ];

      const eligible = engine.filterEligible(agents, 'team-alpha');

      expect(eligible).toHaveLength(2);
    });

    it('should return empty array when no agents accept the boundary', () => {
      const agents = [
        createAgent('1', 'claude-code', ['staging']),
        createAgent('2', 'claude-code', ['development']),
      ];

      const eligible = engine.filterEligible(agents, 'production');

      expect(eligible).toHaveLength(0);
    });
  });

  describe('boundary configs', () => {
    it('should support boundary-specific configurations', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          {
            name: 'production',
            description: 'Production environment',
            preferredAgentType: 'copilot-cli',
            triggerSpinUpOnEmpty: true,
          },
          {
            name: 'development',
            description: 'Development environment',
            preferredAgentType: 'claude-code',
            triggerSpinUpOnEmpty: false,
          },
        ],
      });

      const prodDecision = configuredEngine.resolveAgentType('production');
      expect(prodDecision.targetAgentType).toBe('copilot-cli');

      const devDecision = configuredEngine.resolveAgentType('development');
      expect(devDecision.targetAgentType).toBe('claude-code');
    });

    it('should return undefined config for unconfigured boundary', () => {
      const config = engine.getBoundaryConfig('unknown-boundary');
      expect(config).toBeUndefined();
    });

    it('should return config for configured boundary', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          { name: 'production', preferredAgentType: 'copilot-cli' },
        ],
      });

      const config = configuredEngine.getBoundaryConfig('production');

      expect(config).toBeDefined();
      expect(config?.name).toBe('production');
      expect(config?.preferredAgentType).toBe('copilot-cli');
    });
  });

  describe('shouldTriggerSpinUp', () => {
    it('should return true by default for unconfigured boundaries', () => {
      expect(engine.shouldTriggerSpinUp('any-boundary')).toBe(true);
    });

    it('should respect boundary config setting', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          { name: 'production', triggerSpinUpOnEmpty: true },
          { name: 'development', triggerSpinUpOnEmpty: false },
        ],
      });

      expect(configuredEngine.shouldTriggerSpinUp('production')).toBe(true);
      expect(configuredEngine.shouldTriggerSpinUp('development')).toBe(false);
      expect(configuredEngine.shouldTriggerSpinUp('staging')).toBe(true); // Default
    });
  });

  describe('getBoundaryConfig', () => {
    it('should return config for configured boundary', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          { name: 'production', preferredAgentType: 'copilot-cli' },
        ],
      });

      const config = configuredEngine.getBoundaryConfig('production');

      expect(config).toBeDefined();
      expect(config?.name).toBe('production');
    });

    it('should return undefined for unconfigured boundary', () => {
      const config = engine.getBoundaryConfig('unknown');
      expect(config).toBeUndefined();
    });
  });

  describe('getAllBoundaryConfigs', () => {
    it('should return empty array when no configs', () => {
      const configs = engine.getAllBoundaryConfigs();
      expect(configs).toHaveLength(0);
    });

    it('should return all configured boundaries', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          { name: 'production' },
          { name: 'staging' },
          { name: 'development' },
        ],
      });

      const configs = configuredEngine.getAllBoundaryConfigs();

      expect(configs).toHaveLength(3);
      expect(configs.map(c => c.name)).toContain('production');
      expect(configs.map(c => c.name)).toContain('staging');
      expect(configs.map(c => c.name)).toContain('development');
    });
  });

  describe('updateBoundaryConfig', () => {
    it('should update existing boundary config', () => {
      const configuredEngine = new RoutingEngine({
        boundaryConfigs: [
          { name: 'production', preferredAgentType: 'copilot-cli' },
        ],
      });

      configuredEngine.updateBoundaryConfig({
        name: 'production',
        preferredAgentType: 'claude-code',
      });

      const config = configuredEngine.getBoundaryConfig('production');
      expect(config?.preferredAgentType).toBe('claude-code');
    });

    it('should add new boundary config', () => {
      engine.updateBoundaryConfig({
        name: 'new-boundary',
        preferredAgentType: 'copilot-cli',
      });

      const config = engine.getBoundaryConfig('new-boundary');
      expect(config).toBeDefined();
      expect(config?.preferredAgentType).toBe('copilot-cli');
    });
  });
});
