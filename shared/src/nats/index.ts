// NATS client utilities
export {
  createNATSClient,
  encodeMessage,
  decodeMessage,
  type ConnectedClient,
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
