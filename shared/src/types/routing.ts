import type { AgentType, Boundary } from './work-item.js';

/**
 * Routing decision result
 *
 * With user-defined boundaries, routing is straightforward:
 * work with boundary X is routed to agents that include X in their boundaries.
 */
export interface RoutingDecision {
  /** The boundary that was evaluated */
  boundary: Boundary;

  /** Target agent type based on availability and preferences */
  targetAgentType: AgentType;

  /** Whether this is the preferred type or a fallback */
  isFallback: boolean;

  /** Agent types that were considered */
  consideredTypes: AgentType[];

  /** Reason for the decision */
  reason: string;
}

/**
 * Agent eligibility check result
 */
export interface EligibilityResult {
  /** Whether the agent is eligible */
  eligible: boolean;

  /** Reason if not eligible */
  reason?: string;
}

/**
 * Boundary configuration for advanced routing behavior
 */
export interface BoundaryConfig {
  /** The boundary name */
  name: Boundary;

  /** Description of this boundary's purpose */
  description?: string;

  /** Preferred agent type for work in this boundary */
  preferredAgentType?: AgentType;

  /** Fallback agent type if preferred unavailable */
  fallbackAgentType?: AgentType;

  /** Whether to trigger spin-up if no agents available */
  triggerSpinUpOnEmpty?: boolean;
}
