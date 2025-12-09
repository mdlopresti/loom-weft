/**
 * Routing engine
 *
 * Implements boundary-aware routing logic for work items.
 * With user-defined boundaries, routing is straightforward:
 * work with boundary X is routed to agents that include X in their boundaries.
 */

import type {
  RoutingDecision,
  EligibilityResult,
  Boundary,
  BoundaryConfig,
  AgentType,
  RegisteredAgent,
} from '@loom/shared';

export interface RoutingEngineConfig {
  /** Optional boundary-specific configurations */
  boundaryConfigs?: BoundaryConfig[];
}

/**
 * Routing engine for boundary-aware work distribution
 */
export class RoutingEngine {
  private boundaryConfigs: Map<Boundary, BoundaryConfig>;

  constructor(config?: RoutingEngineConfig) {
    this.boundaryConfigs = new Map(
      (config?.boundaryConfigs ?? []).map(bc => [bc.name, bc])
    );
  }

  /**
   * Resolve which agent type should handle work in a boundary
   *
   * @param boundary The workload boundary
   * @param availableTypes Agent types currently available (optional)
   * @returns Routing decision
   */
  resolveAgentType(
    boundary: Boundary,
    availableTypes?: AgentType[]
  ): RoutingDecision {
    const config = this.boundaryConfigs.get(boundary);

    // If no availability info, use preferred type from config or default to any
    if (!availableTypes || availableTypes.length === 0) {
      const targetType = config?.preferredAgentType ?? 'claude-code';
      return {
        boundary,
        targetAgentType: targetType,
        isFallback: false,
        consideredTypes: [targetType],
        reason: config?.preferredAgentType
          ? 'Preferred agent type from boundary config (no availability info)'
          : 'Default agent type (no availability info)',
      };
    }

    // Try preferred type first if configured
    if (config?.preferredAgentType && availableTypes.includes(config.preferredAgentType)) {
      return {
        boundary,
        targetAgentType: config.preferredAgentType,
        isFallback: false,
        consideredTypes: [config.preferredAgentType],
        reason: 'Preferred agent type is available',
      };
    }

    // Try fallback type if configured
    if (config?.fallbackAgentType && availableTypes.includes(config.fallbackAgentType)) {
      return {
        boundary,
        targetAgentType: config.fallbackAgentType,
        isFallback: true,
        consideredTypes: config.preferredAgentType
          ? [config.preferredAgentType, config.fallbackAgentType]
          : [config.fallbackAgentType],
        reason: 'Using fallback agent type',
      };
    }

    // Use first available type
    const targetType = availableTypes[0] ?? 'claude-code';
    return {
      boundary,
      targetAgentType: targetType as AgentType,
      isFallback: !config?.preferredAgentType,
      consideredTypes: availableTypes,
      reason: 'Using first available agent type',
    };
  }

  /**
   * Check if an agent is eligible to handle work in a boundary
   *
   * @param agent The agent to check
   * @param boundary The workload boundary
   * @returns Eligibility result
   */
  isEligible(agent: RegisteredAgent, boundary: Boundary): EligibilityResult {
    // Check if agent accepts this boundary
    if (!agent.boundaries.includes(boundary)) {
      return {
        eligible: false,
        reason: `Agent does not accept boundary '${boundary}'`,
      };
    }

    // Check if agent is offline
    if (agent.status === 'offline') {
      return {
        eligible: false,
        reason: 'Agent is offline',
      };
    }

    return {
      eligible: true,
    };
  }

  /**
   * Filter agents by eligibility for a boundary
   *
   * @param agents List of agents to filter
   * @param boundary The workload boundary
   * @returns Eligible agents
   */
  filterEligible(agents: RegisteredAgent[], boundary: Boundary): RegisteredAgent[] {
    return agents.filter(agent => this.isEligible(agent, boundary).eligible);
  }

  /**
   * Get the boundary configuration
   */
  getBoundaryConfig(boundary: Boundary): BoundaryConfig | undefined {
    return this.boundaryConfigs.get(boundary);
  }

  /**
   * Check if spin-up should be triggered when no agents available
   */
  shouldTriggerSpinUp(boundary: Boundary): boolean {
    const config = this.boundaryConfigs.get(boundary);
    return config?.triggerSpinUpOnEmpty ?? true;
  }

  /**
   * Get all boundary configurations
   */
  getAllBoundaryConfigs(): BoundaryConfig[] {
    return Array.from(this.boundaryConfigs.values());
  }

  /**
   * Update a boundary configuration
   */
  updateBoundaryConfig(config: BoundaryConfig): void {
    this.boundaryConfigs.set(config.name, config);
  }
}
