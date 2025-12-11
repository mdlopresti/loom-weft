import { connect as connectTcp, NatsConnection, JetStreamClient, JetStreamManager, ConnectionOptions } from 'nats';
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
 * Transport type for NATS connection
 */
export type NatsTransport = 'tcp' | 'websocket';

/**
 * Parsed NATS URL components
 */
export interface ParsedNatsUrl {
  /** Server URL without credentials (e.g., "nats://host:4222" or "wss://host") */
  server: string;
  /** Username if present in URL */
  user?: string;
  /** Password if present in URL */
  pass?: string;
  /** Transport type detected from URL scheme */
  transport: NatsTransport;
}

/**
 * Detect transport type from URL scheme
 */
export function detectTransport(url: string): NatsTransport {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.startsWith('wss://') || lowerUrl.startsWith('ws://')) {
    return 'websocket';
  }
  return 'tcp';
}

/**
 * Parse a NATS URL that may contain credentials
 *
 * Supports formats:
 * - nats://host:port (TCP, no auth)
 * - nats://user:pass@host:port (TCP with auth)
 * - tls://host:port (TCP with TLS)
 * - wss://host/path (WebSocket secure)
 * - wss://user:pass@host/path (WebSocket with auth)
 * - ws://host:port (WebSocket insecure)
 *
 * @param url - NATS URL to parse
 * @returns Parsed components with server URL, credentials, and transport type
 */
export function parseNatsUrl(url: string): ParsedNatsUrl {
  const transport = detectTransport(url);

  try {
    // Normalize URL for parsing
    let normalizedUrl: string;
    if (url.startsWith('nats://')) {
      normalizedUrl = url.replace(/^nats:\/\//, 'http://');
    } else if (url.startsWith('tls://')) {
      normalizedUrl = url.replace(/^tls:\/\//, 'https://');
    } else if (url.startsWith('wss://')) {
      normalizedUrl = url.replace(/^wss:\/\//, 'https://');
    } else if (url.startsWith('ws://')) {
      normalizedUrl = url.replace(/^ws:\/\//, 'http://');
    } else {
      // Assume nats:// for bare host:port
      normalizedUrl = `http://${url}`;
    }

    const parsed = new URL(normalizedUrl);

    // Reconstruct the server URL without credentials
    let server: string;
    if (transport === 'websocket') {
      // For WebSocket, preserve the path
      const protocol = url.toLowerCase().startsWith('ws://') ? 'ws' : 'wss';
      server = `${protocol}://${parsed.host}${parsed.pathname}${parsed.search}`;
    } else {
      // For TCP, use nats:// scheme
      server = `nats://${parsed.host}`;
    }

    const result: ParsedNatsUrl = { server, transport };

    // Extract credentials if present
    if (parsed.username) {
      result.user = decodeURIComponent(parsed.username);
    }
    if (parsed.password) {
      result.pass = decodeURIComponent(parsed.password);
    }

    return result;
  } catch {
    // If URL parsing fails, return as-is
    return { server: url, transport };
  }
}

/**
 * Initialize WebSocket shim for Node.js
 * Must be called before using nats.ws
 */
async function initWebSocketShim(): Promise<void> {
  // Dynamic import to avoid loading ws when using TCP
  const ws = await import('ws');
  (globalThis as unknown as { WebSocket: typeof ws.default }).WebSocket = ws.default;
}

/**
 * Connect using WebSocket transport
 */
async function connectWebSocket(opts: ConnectionOptions): Promise<NatsConnection> {
  await initWebSocketShim();
  // Dynamic import nats.ws after shim is in place
  const { connect: connectWs } = await import('nats.ws');
  return connectWs(opts);
}

/**
 * Create a NATS connection with JetStream enabled
 *
 * Supports both TCP and WebSocket transports:
 * - TCP: nats://host:port, tls://host:port
 * - WebSocket: wss://host/path, ws://host:port
 *
 * Transport is auto-detected from URL scheme.
 *
 * Supports authentication via:
 * 1. Credentials in URL: nats://user:pass@host:port
 * 2. Environment variables: NATS_USER and NATS_PASS (fallback)
 * 3. Credentials file: config.credentials path
 *
 * Authentication is optional - if no credentials are provided,
 * connects without authentication (suitable for local development).
 */
export async function createNATSClient(config: NATSConfiguration): Promise<ConnectedClient> {
  // Parse URL and extract credentials if present
  const parsed = parseNatsUrl(config.url);

  // Resolve credentials: URL > env vars > credentials file
  const urlUser = parsed.user ?? process.env['NATS_USER'];
  const urlPass = parsed.pass ?? process.env['NATS_PASS'];

  const connectOpts: ConnectionOptions = {
    servers: parsed.server,
    name: config.name ?? 'loom-client',
    reconnect: true,
    maxReconnectAttempts: config.reconnect?.maxAttempts ?? 10,
    reconnectTimeWait: config.reconnect?.delayMs ?? 1000,
  };

  // Add user/pass auth if available (takes precedence over creds file)
  if (urlUser) {
    connectOpts.user = urlUser;
    if (urlPass) {
      connectOpts.pass = urlPass;
    }
  }

  // Build final options, adding credsFile via spread to bypass type check
  // (credsFile is a valid runtime option but not in ConnectionOptions type)
  const finalOpts = config.credentials && !urlUser
    ? { ...connectOpts, credsFile: config.credentials }
    : connectOpts;

  // Use appropriate transport based on URL scheme
  let nc: NatsConnection;
  if (parsed.transport === 'websocket') {
    nc = await connectWebSocket(finalOpts);
  } else {
    nc = await connectTcp(finalOpts);
  }

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
