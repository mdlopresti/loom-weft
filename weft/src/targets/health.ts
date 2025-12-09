import { spawn } from 'node:child_process';
import type { SpinUpTarget, HealthCheckResult } from '@loom/shared';
import type { TargetRegistry } from './registry.js';

/**
 * Health check runner for spin-up targets
 *
 * Periodically checks the health of targets based on their mechanism type.
 */
export class HealthCheckRunner {
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private registry: TargetRegistry,
    private intervalMs: number = 300000 // Default: 5 minutes
  ) {}

  /**
   * Start the health check loop
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Run immediately
    this.runHealthChecks().catch((error) => {
      console.error('Health check error:', error);
    });

    // Then on interval
    this.interval = setInterval(() => {
      this.runHealthChecks().catch((error) => {
        console.error('Health check error:', error);
      });
    }, this.intervalMs);
  }

  /**
   * Stop the health check loop
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
  }

  /**
   * Run health checks for all targets
   */
  private async runHealthChecks(): Promise<void> {
    const targets = await this.registry.getAllTargets();

    // Filter targets that have health checks enabled
    const targetsToCheck = targets.filter(
      (t) => t.healthCheck?.enabled && t.status !== 'disabled'
    );

    // Run checks in parallel
    await Promise.allSettled(
      targetsToCheck.map((target) => this.checkTarget(target))
    );
  }

  /**
   * Check health of a specific target
   */
  async checkTarget(target: SpinUpTarget): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      let result: HealthCheckResult;

      switch (target.mechanism) {
        case 'ssh':
          result = await this.checkSSH(target);
          break;

        case 'webhook':
          result = await this.checkWebhook(target);
          break;

        case 'local':
          // Local targets are always considered healthy if not in-use
          result = {
            targetId: target.id,
            healthy: target.status !== 'error',
            responseTimeMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
          break;

        case 'github-actions':
          // GitHub Actions are always considered healthy (we can't really check them)
          result = {
            targetId: target.id,
            healthy: true,
            responseTimeMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
          break;

        case 'kubernetes':
          // TODO: Implement kubernetes health check
          result = {
            targetId: target.id,
            healthy: true,
            responseTimeMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
          break;

        default:
          result = {
            targetId: target.id,
            healthy: false,
            error: `Unknown mechanism: ${(target as SpinUpTarget).mechanism}`,
            timestamp: new Date().toISOString(),
          };
      }

      // Update target health status
      await this.registry.updateTargetHealth(
        target.id,
        result.healthy ? 'healthy' : 'unhealthy',
        result.error
      );

      return result;
    } catch (error) {
      const result: HealthCheckResult = {
        targetId: target.id,
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
        responseTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      await this.registry.updateTargetHealth(target.id, 'unhealthy', result.error);

      return result;
    }
  }

  /**
   * Check SSH target health by attempting to connect
   */
  private async checkSSH(target: SpinUpTarget): Promise<HealthCheckResult> {
    if (target.config.mechanism !== 'ssh') {
      throw new Error('Target is not SSH');
    }

    const config = target.config.ssh;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const args = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes'];

      if (config.port && config.port !== 22) {
        args.push('-p', config.port.toString());
      }

      if (config.privateKeyPath) {
        args.push('-i', config.privateKeyPath);
      }

      args.push(`${config.user}@${config.host}`, 'echo ok');

      const ssh = spawn('ssh', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        ssh.kill();
        resolve({
          targetId: target.id,
          healthy: false,
          error: 'SSH connection timed out',
          responseTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      }, target.healthCheck?.timeoutMs ?? 10000);

      ssh.on('exit', (code) => {
        clearTimeout(timeout);
        const responseTimeMs = Date.now() - startTime;

        if (code === 0) {
          resolve({
            targetId: target.id,
            healthy: true,
            responseTimeMs,
            timestamp: new Date().toISOString(),
          });
        } else {
          resolve({
            targetId: target.id,
            healthy: false,
            error: `SSH connection failed with exit code ${code}`,
            responseTimeMs,
            timestamp: new Date().toISOString(),
          });
        }
      });

      ssh.on('error', (error) => {
        clearTimeout(timeout);
        resolve({
          targetId: target.id,
          healthy: false,
          error: error.message,
          responseTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      });
    });
  }

  /**
   * Check webhook target health by making a request
   */
  private async checkWebhook(target: SpinUpTarget): Promise<HealthCheckResult> {
    if (target.config.mechanism !== 'webhook') {
      throw new Error('Target is not webhook');
    }

    const config = target.config.webhook;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        target.healthCheck?.timeoutMs ?? 10000
      );

      // Use HEAD request for health check to avoid side effects
      const response = await fetch(config.url, {
        method: 'HEAD',
        headers: config.headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseTimeMs = Date.now() - startTime;
      const successCodes = config.successCodes ?? [200, 201, 202];

      if (successCodes.includes(response.status)) {
        return {
          targetId: target.id,
          healthy: true,
          responseTimeMs,
          timestamp: new Date().toISOString(),
        };
      } else {
        return {
          targetId: target.id,
          healthy: false,
          error: `Webhook returned status ${response.status}`,
          responseTimeMs,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        targetId: target.id,
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
        responseTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

/**
 * One-off health check for a target
 */
export async function checkTargetHealth(
  target: SpinUpTarget,
  registry: TargetRegistry
): Promise<HealthCheckResult> {
  const runner = new HealthCheckRunner(registry);
  return await runner.checkTarget(target);
}
