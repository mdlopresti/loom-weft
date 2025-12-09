/**
 * Coordinator module
 * Extends the base coordinator with classification-aware routing and spin-up triggers
 */

export { ExtendedCoordinator, createExtendedCoordinator } from './coordinator.js';
export type { ExtendedCoordinatorConfig, ClassifiedWorkRequest, SpinUpTriggerEvent, WorkStateChangeEvent } from './coordinator.js';

export { BaseCoordinator } from './base-coordinator.js';
export type { BaseCoordinatorConfig, WorkRequest, AssignmentFilter, CoordinatorStats } from './base-coordinator.js';

export { initializeRegistry, listRegistryEntries, getRegistryEntry, isVisibleTo, toRegisteredAgent, filterByBoundary, getRegistryKV } from './registry.js';
export type { RegistryEntry, Requester } from './registry.js';
