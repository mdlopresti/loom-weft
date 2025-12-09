import { connect, NatsConnection, JetStreamClient, JetStreamManager } from 'nats';
import type { NATSConfiguration } from '../types/config.js';

/**
 * Connected NATS client with JetStream
 */
export interface ConnectedClient {
  /** Raw NATS connection */
  nc: NatsConnection;

  /** JetStream client for publishing/consuming */
  js: JetStreamClient;

  /** JetStream manager for admin operations */
  jsm: JetStreamManager;

  /** Close the connection */
  close: () => Promise<void>;
}

/**
 * Create a NATS connection with JetStream enabled
 */
export async function createNATSClient(config: NATSConfiguration): Promise<ConnectedClient> {
  const nc = await connect({
    servers: config.url,
    name: config.name ?? 'coord-client',
    reconnect: true,
    maxReconnectAttempts: config.reconnect?.maxAttempts ?? 10,
    reconnectTimeWait: config.reconnect?.delayMs ?? 1000,
    // Credentials file if specified
    ...(config.credentials ? { credsFile: config.credentials } : {}),
  });

  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();

  return {
    nc,
    js,
    jsm,
    close: async () => {
      await nc.drain();
      await nc.close();
    },
  };
}

/**
 * Encode data for NATS message
 */
export function encodeMessage<T>(data: T): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}

/**
 * Decode NATS message data
 */
export function decodeMessage<T>(data: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(data)) as T;
}
