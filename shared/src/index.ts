/**
 * @loom/shared - Shared types and utilities for the coordinator system
 *
 * This package provides:
 * - Type definitions for work items, agents, routing, and configuration
 * - NATS subject patterns and client utilities
 * - Default routing rules
 */

// Re-export all types
export * from './types/index.js';

// Re-export NATS utilities
export * from './nats/index.js';
