import { spawn } from 'node:child_process';
import type { SpinUpTarget, SpinUpResult, SSHMechanismConfig } from '@loom/shared';

/**
 * Spin up an agent using SSH
 *
 * Uses the `ssh` command to connect to a remote host and execute a command.
 * Supports key-based authentication via ssh-agent or explicit private key path.
 *
 * @param target - Target configuration with SSH mechanism
 * @returns Spin-up result with remote process information
 */
export async function sshSpinUp(target: SpinUpTarget): Promise<SpinUpResult> {
  if (target.config.mechanism !== 'ssh') {
    throw new Error(`Expected SSH mechanism, got ${target.config.mechanism}`);
  }

  const config = target.config.ssh;

  return new Promise((resolve, reject) => {
    const args = buildSSHArgs(config);

    // Spawn SSH process
    const ssh = spawn('ssh', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Capture output
    ssh.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    ssh.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Set connection timeout
    const timeoutMs = config.connectionTimeoutMs ?? 30000;
    const timeout = setTimeout(() => {
      ssh.kill();
      reject(new Error(`SSH connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ssh.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`SSH spawn error: ${error.message}`));
    });

    ssh.on('exit', (code, signal) => {
      clearTimeout(timeout);

      if (code === 0) {
        // Success - command executed
        resolve({
          success: true,
          targetId: target.id,
          targetName: target.name,
          mechanismResult: {
            // SSH doesn't give us the remote PID easily, but we can include output
            response: { stdout, stderr },
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        // Failed
        const errorMsg = stderr || stdout || `SSH exited with code ${code ?? `signal ${signal}`}`;
        reject(new Error(`SSH command failed: ${errorMsg}`));
      }
    });

    // Detach the process so it continues after we exit
    ssh.unref();
  });
}

/**
 * Build SSH command arguments
 */
function buildSSHArgs(config: SSHMechanismConfig): string[] {
  const args: string[] = [];

  // Port
  if (config.port && config.port !== 22) {
    args.push('-p', config.port.toString());
  }

  // Private key
  if (config.privateKeyPath) {
    args.push('-i', config.privateKeyPath);
  }

  // Connection options
  args.push(
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'BatchMode=yes', // Don't prompt for passwords
    '-o', `ConnectTimeout=${Math.floor((config.connectionTimeoutMs ?? 30000) / 1000)}`
  );

  // User@host
  args.push(`${config.user}@${config.host}`);

  // Build remote command
  let remoteCommand = config.command;

  // Change directory if specified
  if (config.workingDirectory) {
    remoteCommand = `cd ${escapeShell(config.workingDirectory)} && ${remoteCommand}`;
  }

  // Add environment variables if specified
  if (config.env && Object.keys(config.env).length > 0) {
    const envPrefix = Object.entries(config.env)
      .map(([key, value]) => `${key}=${escapeShell(value)}`)
      .join(' ');
    remoteCommand = `${envPrefix} ${remoteCommand}`;
  }

  args.push(remoteCommand);

  return args;
}

/**
 * Escape a shell argument
 */
function escapeShell(arg: string): string {
  // Simple escaping - wrap in single quotes and escape any single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
