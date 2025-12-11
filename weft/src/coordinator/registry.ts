/**
 * Agent Registry Utilities
 *
 * Functions for interacting with the agent registry stored in NATS KV.
 * Provides agent discovery, visibility filtering, and type conversion.
 */

import type { KV, NatsConnection } from 'nats';
import type {
  RegisteredAgent,
  AgentType,
  Boundary,
  AgentStatus,
  AgentVisibility,
} from '@loom/shared';

/**
 * Registry entry as stored in NATS KV
 */
export interface RegistryEntry {
  guid: string;
  handle: string;
  hostname: string;
  projectId: string;
  username?: string;
  capabilities: string[];
  visibility: AgentVisibility;
  status: AgentStatus;
  currentTaskCount: number;
  maxConcurrentTasks: number;
  spindownAfterIdleMs: number;
  lastHeartbeat: string;
  lastActivity: string;
  registeredAt: string;
  metadata?: {
    agentType?: AgentType;
    boundaries?: Boundary[];
    [key: string]: unknown;
  };
}

/**
 * Requester context for visibility checks
 */
export interface Requester {
  guid: string;
  projectId: string;
  username?: string;
}

// Module-level KV reference (set by initialize)
let registryKV: KV | null = null;
let bucketName = 'agent-registry';

/**
 * Initialize the registry with a NATS connection
 */
export async function initializeRegistry(
  nc: NatsConnection,
  _projectId: string // Kept for API compatibility; bucket is shared across all projects
): Promise<void> {
  const js = nc.jetstream();
  // Must match Warp's bucket name: DEFAULT_BUCKET_NAME = 'agent-registry' in warp/src/kv.ts
  bucketName = 'agent-registry';

  try {
    registryKV = await js.views.kv(bucketName);
  } catch {
    // Create the bucket if it doesn't exist
    registryKV = await js.views.kv(bucketName, {
      history: 1,
      ttl: 0, // No TTL, we manage cleanup ourselves
    });
  }
}

/**
 * Get the registry KV store
 */
export function getRegistryKV(): KV | null {
  return registryKV;
}

/**
 * List all registry entries
 */
export async function listRegistryEntries(): Promise<RegistryEntry[]> {
  if (!registryKV) {
    return [];
  }

  const entries: RegistryEntry[] = [];
  const keys = await registryKV.keys();

  for await (const key of keys) {
    try {
      const entry = await registryKV.get(key);
      if (entry?.value) {
        const data = JSON.parse(new TextDecoder().decode(entry.value)) as RegistryEntry;
        entries.push(data);
      }
    } catch {
      // Skip invalid entries
    }
  }

  return entries;
}

/**
 * Get a specific registry entry by GUID
 */
export async function getRegistryEntry(guid: string): Promise<RegistryEntry | null> {
  if (!registryKV) {
    return null;
  }

  try {
    const entry = await registryKV.get(guid);
    if (entry?.value) {
      return JSON.parse(new TextDecoder().decode(entry.value)) as RegistryEntry;
    }
  } catch {
    // Entry not found
  }

  return null;
}

/**
 * Check if an entry is visible to a requester
 */
export function isVisibleTo(entry: RegistryEntry, requester: Requester): boolean {
  // Self is always visible
  if (entry.guid === requester.guid) {
    return true;
  }

  switch (entry.visibility) {
    case 'private':
      // Only visible to self
      return false;

    case 'project-only':
      // Must be in same project
      return entry.projectId === requester.projectId;

    case 'user-only':
      // Must be same user
      return entry.username !== undefined && entry.username === requester.username;

    case 'public':
      // Visible to everyone
      return true;

    default:
      // Default to project-only
      return entry.projectId === requester.projectId;
  }
}

/**
 * Convert a registry entry to a RegisteredAgent
 */
export function toRegisteredAgent(entry: RegistryEntry): RegisteredAgent {
  return {
    guid: entry.guid,
    handle: entry.handle,
    agentType: (entry.metadata?.agentType as AgentType) ?? 'claude-code',
    status: entry.status,
    capabilities: entry.capabilities,
    boundaries: (entry.metadata?.boundaries as Boundary[]) ?? ['default'],
    hostname: entry.hostname,
    projectId: entry.projectId,
    username: entry.username,
    visibility: entry.visibility,
    currentTaskCount: entry.currentTaskCount,
    maxConcurrentTasks: entry.maxConcurrentTasks,
    spindownAfterIdleMs: entry.spindownAfterIdleMs,
    lastHeartbeat: entry.lastHeartbeat,
    lastActivity: entry.lastActivity,
    registeredAt: entry.registeredAt,
  };
}

/**
 * Filter agents by boundary eligibility
 */
export function filterByBoundary(
  agents: RegisteredAgent[],
  boundary: Boundary
): RegisteredAgent[] {
  return agents.filter(agent => {
    return agent.boundaries.includes(boundary);
  });
}
