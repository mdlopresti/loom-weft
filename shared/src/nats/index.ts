// NATS client utilities
export {
  createNATSClient,
  parseNatsUrl,
  detectTransport,
  encodeMessage,
  decodeMessage,
  type ConnectedClient,
  type ParsedNatsUrl,
  type NatsTransport,
} from './client.js';

// Subject patterns
export {
  buildSubject,
  WorkSubjects,
  AgentSubjects,
  CoordinatorSubjects,
  TargetSubjects,
  StreamNames,
  KVBuckets,
} from './subjects.js';
