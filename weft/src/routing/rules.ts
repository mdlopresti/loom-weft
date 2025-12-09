/**
 * Boundary configuration helpers
 *
 * With user-defined boundaries, there are no default rules.
 * This module provides helpers for creating and managing boundary configurations.
 */

import type { BoundaryConfig, Boundary, AgentType } from '@loom/shared';

/**
 * Create a boundary configuration
 */
export function createBoundaryConfig(
  name: Boundary,
  options?: {
    description?: string;
    preferredAgentType?: AgentType;
    fallbackAgentType?: AgentType;
    triggerSpinUpOnEmpty?: boolean;
  }
): BoundaryConfig {
  return {
    name,
    description: options?.description,
    preferredAgentType: options?.preferredAgentType,
    fallbackAgentType: options?.fallbackAgentType,
    triggerSpinUpOnEmpty: options?.triggerSpinUpOnEmpty ?? true,
  };
}

/**
 * Merge boundary configurations
 * Later configurations override earlier ones for the same boundary
 */
export function mergeBoundaryConfigs(configs: BoundaryConfig[]): BoundaryConfig[] {
  const configMap = new Map<Boundary, BoundaryConfig>();

  for (const config of configs) {
    configMap.set(config.name, config);
  }

  return Array.from(configMap.values());
}
