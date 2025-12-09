import { spawn } from 'node:child_process';
import type { SpinUpTarget, SpinUpResult } from '@loom/shared';

/**
 * Spin up an agent as a local process
 *
 * Spawns a new process on the local machine. The process can be detached
 * to continue running after the coordinator exits.
 *
 * @param target - Target configuration with local mechanism
 * @returns Spin-up result with process information
 */
export async function localSpinUp(target: SpinUpTarget): Promise<SpinUpResult> {
  if (target.config.mechanism !== 'local') {
    throw new Error(`Expected local mechanism, got ${target.config.mechanism}`);
  }

  const config = target.config.local;

  return new Promise((resolve, reject) => {
    // Prepare spawn options
    const detached = config.detached ?? true;
    const cwd = config.workingDirectory ?? process.cwd();
    const env = {
      ...process.env,
      ...(config.env ?? {}),
    };

    // Spawn the process
    const child = spawn(config.command, config.args ?? [], {
      detached,
      cwd,
      env,
      stdio: detached ? ['ignore', 'pipe', 'pipe'] : 'pipe',
    });

    let stdout = '';
    let stderr = '';

    // Capture output
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Handle errors
    child.on('error', (error) => {
      reject(new Error(`Failed to spawn local process: ${error.message}`));
    });

    // If detached, we don't wait for the process to exit
    if (detached) {
      // Give it a moment to ensure it starts successfully
      setTimeout(() => {
        if (child.pid) {
          // Process started successfully
          child.unref(); // Allow coordinator to exit without waiting

          resolve({
            success: true,
            targetId: target.id,
            targetName: target.name,
            mechanismResult: {
              pid: child.pid,
            },
            timestamp: new Date().toISOString(),
          });
        } else {
          reject(new Error('Failed to spawn local process: no PID'));
        }
      }, 500);
    } else {
      // Wait for process to exit
      child.on('exit', (code, signal) => {
        if (code === 0) {
          resolve({
            success: true,
            targetId: target.id,
            targetName: target.name,
            mechanismResult: {
              pid: child.pid,
              response: { stdout, stderr },
            },
            timestamp: new Date().toISOString(),
          });
        } else {
          const errorMsg = stderr || stdout || `Process exited with code ${code ?? `signal ${signal}`}`;
          reject(new Error(`Local process failed: ${errorMsg}`));
        }
      });
    }
  });
}
