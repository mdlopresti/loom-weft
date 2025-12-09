import type { SpinUpTarget, SpinUpResult } from '@loom/shared';

/**
 * Spin-up request with optional work item context
 */
export interface SpinUpRequest {
  /** Target to spin up */
  target: SpinUpTarget;

  /** Work item ID that triggered this spin-up (if any) */
  workItemId?: string;

  /** Capability needed (if specific) */
  capability?: string;

  /** Timestamp of request */
  requestedAt: string;
}

/**
 * Status of a spin-up operation
 */
export type SpinUpStatus = 'pending' | 'in-progress' | 'success' | 'failed' | 'timeout';

/**
 * Tracked spin-up operation
 */
export interface TrackedSpinUp {
  /** Unique ID for this spin-up operation */
  id: string;

  /** Request details */
  request: SpinUpRequest;

  /** Current status */
  status: SpinUpStatus;

  /** Result if completed */
  result?: SpinUpResult;

  /** Error if failed */
  error?: string;

  /** Timestamp when started */
  startedAt: string;

  /** Timestamp when completed */
  completedAt?: string;

  /** Timeout timestamp */
  timeoutAt: string;
}

/**
 * Spin-up manager events
 */
export interface SpinUpManagerEvents {
  /** Emitted when spin-up is requested */
  'spin-up:requested': (tracked: TrackedSpinUp) => void;

  /** Emitted when spin-up starts */
  'spin-up:started': (tracked: TrackedSpinUp) => void;

  /** Emitted when spin-up succeeds */
  'spin-up:success': (tracked: TrackedSpinUp) => void;

  /** Emitted when spin-up fails */
  'spin-up:failed': (tracked: TrackedSpinUp) => void;

  /** Emitted when spin-up times out */
  'spin-up:timeout': (tracked: TrackedSpinUp) => void;
}
