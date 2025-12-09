import type { ConnectedClient } from '@loom/shared';
import type { Boundary, SpinUpTarget } from '@loom/shared';
import { KVBuckets, TargetSubjects, encodeMessage } from '@loom/shared';
import { v4 as uuidv4 } from 'uuid';
import { hostname } from 'os';

/**
 * Target registration options
 */
export interface TargetRegistrationOptions {
  /** Target name (unique identifier) */
  targetName: string;

  /** Capabilities the spawned agent will have */
  capabilities: string[];

  /** Workload boundaries this target can handle */
  boundaries: Boundary[];

  /** Description */
  description?: string;

  /** Command to start this bridge */
  command?: string;

  /** Working directory */
  workingDirectory?: string;

  /** Environment variables to pass */
  env?: Record<string, string>;
}

/**
 * Register this bridge as a spin-up target
 */
export async function registerSelfAsTarget(
  client: ConnectedClient,
  projectId: string,
  options: TargetRegistrationOptions,
): Promise<SpinUpTarget> {
  console.log(`\nRegistering self as spin-up target: ${options.targetName}`);

  // Get or create targets KV bucket
  const kv = await client.js.views.kv(KVBuckets.targetRegistry(projectId));

  // Check if target already exists
  let existingTarget: SpinUpTarget | null = null;
  try {
    const entry = await kv.get(options.targetName);
    if (entry) {
      existingTarget = JSON.parse(new TextDecoder().decode(entry.value));
      console.log('  Target already exists, updating...');
    }
  } catch (error) {
    // Target doesn't exist, that's fine
  }

  // Build the target object
  const now = new Date().toISOString();
  const target: SpinUpTarget = {
    id: existingTarget?.id || uuidv4(),
    name: options.targetName,
    description: options.description || `Copilot CLI bridge on ${hostname()}`,
    agentType: 'copilot-cli',
    capabilities: options.capabilities,
    boundaries: options.boundaries,
    mechanism: 'local',
    config: {
      mechanism: 'local',
      local: {
        command: options.command ?? process.argv[0] ?? 'node',
        args: options.command ? [] : process.argv.slice(1),
        workingDirectory: options.workingDirectory ?? process.cwd(),
        env: options.env ?? {},
        detached: true,
      },
    },
    status: 'available',
    healthStatus: 'unknown',
    registeredBy: 'agent',
    registeredAt: existingTarget?.registeredAt || now,
    updatedAt: now,
    useCount: existingTarget?.useCount || 0,
  };

  // Store in KV
  await kv.put(options.targetName, encodeMessage(target));

  // Publish registration event
  await client.nc.publish(
    TargetSubjects.register(projectId),
    encodeMessage({
      targetId: target.id,
      targetName: target.name,
      agentType: target.agentType,
      timestamp: now,
    }),
  );

  console.log('  Target registered successfully');
  console.log(`    Target ID: ${target.id}`);
  console.log(`    Mechanism: local`);
  console.log(`    Capabilities: ${target.capabilities.join(', ')}`);
  console.log(`    Boundaries: ${target.boundaries.join(', ')}`);

  return target;
}

/**
 * Update target status (e.g., mark as in-use when agent starts)
 */
export async function updateTargetStatus(
  client: ConnectedClient,
  projectId: string,
  targetName: string,
  status: 'available' | 'in-use' | 'disabled' | 'error',
  currentAgentGuid?: string,
): Promise<void> {
  const kv = await client.js.views.kv(KVBuckets.targetRegistry(projectId));

  // Get current target
  const entry = await kv.get(targetName);
  if (!entry) {
    throw new Error(`Target not found: ${targetName}`);
  }

  const target: SpinUpTarget = JSON.parse(new TextDecoder().decode(entry.value));

  // Update status
  target.status = status;
  target.currentAgentGuid = currentAgentGuid;
  target.updatedAt = new Date().toISOString();

  if (status === 'in-use' && currentAgentGuid) {
    target.lastUsedAt = target.updatedAt;
    target.useCount++;
  }

  // Store updated target
  await kv.put(targetName, encodeMessage(target));

  // Publish update event
  await client.nc.publish(
    TargetSubjects.update(projectId),
    encodeMessage({
      targetId: target.id,
      targetName: target.name,
      status: target.status,
      currentAgentGuid: target.currentAgentGuid,
      timestamp: target.updatedAt,
    }),
  );

  console.log(`  Target ${targetName} status updated: ${status}`);
}

/**
 * Link agent to target (mark target as in-use)
 */
export async function linkAgentToTarget(
  client: ConnectedClient,
  projectId: string,
  targetName: string,
  agentGuid: string,
): Promise<void> {
  await updateTargetStatus(client, projectId, targetName, 'in-use', agentGuid);
}

/**
 * Unlink agent from target (mark target as available)
 */
export async function unlinkAgentFromTarget(
  client: ConnectedClient,
  projectId: string,
  targetName: string,
): Promise<void> {
  await updateTargetStatus(client, projectId, targetName, 'available', undefined);
}
