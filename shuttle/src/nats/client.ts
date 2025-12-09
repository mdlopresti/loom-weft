/**
 * NATS client connection helper
 */

import { connect, NatsConnection, ConnectionOptions } from 'nats';
import type { CLIConfiguration } from '@loom/shared';

export interface NATSClientOptions {
  url: string;
  name?: string;
  credentials?: string;
}

let cachedConnection: NatsConnection | null = null;

/**
 * Create or get cached NATS connection
 */
export async function getNATSConnection(
  config: CLIConfiguration
): Promise<NatsConnection> {
  if (cachedConnection && !cachedConnection.isClosed()) {
    return cachedConnection;
  }

  const opts: ConnectionOptions = {
    servers: config.natsUrl || 'nats://localhost:4222',
    name: 'coord-cli',
    maxReconnectAttempts: 10,
    reconnectTimeWait: 1000,
  };

  // TODO: Add credentials support if needed
  // if (config.natsCredentials) {
  //   opts.authenticator = credsAuthenticator(
  //     new TextEncoder().encode(config.natsCredentials)
  //   );
  // }

  cachedConnection = await connect(opts);
  return cachedConnection;
}

/**
 * Close the NATS connection
 */
export async function closeNATSConnection(): Promise<void> {
  if (cachedConnection && !cachedConnection.isClosed()) {
    await cachedConnection.drain();
    await cachedConnection.close();
    cachedConnection = null;
  }
}

/**
 * Subject builders for coordinator system
 */
export class CoordinatorSubjects {
  constructor(private projectId: string) {}

  // Work submission and management
  workSubmit(): string {
    return `coord.${this.projectId}.work.submit`;
  }

  workStatus(workItemId: string): string {
    return `coord.${this.projectId}.work.status.${workItemId}`;
  }

  workList(): string {
    return `coord.${this.projectId}.work.list`;
  }

  workGet(): string {
    return `coord.${this.projectId}.work.get`;
  }

  workCancel(): string {
    return `coord.${this.projectId}.work.cancel`;
  }

  // Agent management
  agentsList(): string {
    return `coord.${this.projectId}.agents.list`;
  }

  agentDetails(agentGuid: string): string {
    return `coord.${this.projectId}.agents.${agentGuid}`;
  }

  agentShutdown(): string {
    return `coord.${this.projectId}.agents.shutdown`;
  }

  // Targets
  targetsList(): string {
    return `coord.${this.projectId}.targets.list`;
  }

  targetsRegister(): string {
    return `coord.${this.projectId}.targets.register`;
  }

  targetsGet(): string {
    return `coord.${this.projectId}.targets.get`;
  }

  targetsUpdate(): string {
    return `coord.${this.projectId}.targets.update`;
  }

  targetsRemove(): string {
    return `coord.${this.projectId}.targets.remove`;
  }

  targetsTest(): string {
    return `coord.${this.projectId}.targets.test`;
  }

  targetsEnable(): string {
    return `coord.${this.projectId}.targets.enable`;
  }

  targetsDisable(): string {
    return `coord.${this.projectId}.targets.disable`;
  }

  // Spin-up operations
  spinUpTrigger(): string {
    return `coord.${this.projectId}.spin-up.trigger`;
  }

  spinUpStatus(): string {
    return `coord.${this.projectId}.spin-up.status`;
  }

  spinUpList(): string {
    return `coord.${this.projectId}.spin-up.list`;
  }

  // Stats
  stats(): string {
    return `coord.${this.projectId}.stats`;
  }
}
