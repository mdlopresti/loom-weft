import { spawn } from 'node:child_process';
import type { SpinUpTarget, SpinUpResult, KubernetesMechanismConfig } from '@loom/shared';
import { randomUUID } from 'node:crypto';

/**
 * Spin up an agent using Kubernetes Job
 *
 * Creates a Kubernetes Job that runs the agent container.
 * Uses kubectl to apply the job manifest.
 *
 * @param target - Target configuration with Kubernetes mechanism
 * @returns Spin-up result with job information
 */
export async function kubernetesSpinUp(target: SpinUpTarget): Promise<SpinUpResult> {
  if (target.config.mechanism !== 'kubernetes') {
    throw new Error(`Expected kubernetes mechanism, got ${target.config.mechanism}`);
  }

  const config = target.config.kubernetes;

  // Generate unique job name
  const jobId = randomUUID().slice(0, 8);
  const jobName = `${config.jobNamePrefix}-${jobId}`;

  // Build job manifest
  const manifest = buildJobManifest(jobName, config, target);

  return new Promise((resolve, reject) => {
    // Use kubectl apply with stdin
    const kubectl = spawn('kubectl', [
      'apply',
      '-f', '-',
      '-n', config.namespace,
      '-o', 'json',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    kubectl.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    kubectl.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Set timeout
    const timeoutMs = 30000;
    const timeout = setTimeout(() => {
      kubectl.kill();
      reject(new Error(`kubectl timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    kubectl.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`kubectl spawn error: ${error.message}`));
    });

    kubectl.on('exit', (code, signal) => {
      clearTimeout(timeout);

      if (code === 0) {
        // Success - job created
        resolve({
          success: true,
          targetId: target.id,
          targetName: target.name,
          mechanismResult: {
            jobName,
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        // Failed
        const errorMsg = stderr || stdout || `kubectl exited with code ${code ?? `signal ${signal}`}`;
        reject(new Error(`kubectl apply failed: ${errorMsg}`));
      }
    });

    // Write manifest to stdin
    kubectl.stdin?.write(JSON.stringify(manifest));
    kubectl.stdin?.end();
  });
}

/**
 * Build Kubernetes Job manifest
 */
function buildJobManifest(
  jobName: string,
  config: KubernetesMechanismConfig,
  target: SpinUpTarget
): Record<string, unknown> {
  // Build environment variables
  const envVars: Array<{ name: string; value: string }> = [];

  // Add target info as env vars
  envVars.push({ name: 'LOOM_TARGET_ID', value: target.id });
  envVars.push({ name: 'LOOM_TARGET_NAME', value: target.name });
  envVars.push({ name: 'LOOM_AGENT_TYPE', value: target.agentType });

  // Add user-specified env vars
  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      envVars.push({ name: key, value });
    }
  }

  // Build container spec
  const container: Record<string, unknown> = {
    name: 'agent',
    image: config.image,
    env: envVars,
  };

  // Add command override if specified
  if (config.command && config.command.length > 0) {
    container.command = config.command;
  }

  // Add args override if specified
  if (config.args && config.args.length > 0) {
    container.args = config.args;
  }

  // Add resource requests if specified
  if (config.resources) {
    container.resources = {
      requests: {
        ...(config.resources.cpu && { cpu: config.resources.cpu }),
        ...(config.resources.memory && { memory: config.resources.memory }),
      },
      limits: {
        ...(config.resources.cpu && { cpu: config.resources.cpu }),
        ...(config.resources.memory && { memory: config.resources.memory }),
      },
    };
  }

  // Build pod spec
  const podSpec: Record<string, unknown> = {
    containers: [container],
    restartPolicy: 'Never',
  };

  // Add service account if specified
  if (config.serviceAccount) {
    podSpec.serviceAccountName = config.serviceAccount;
  }

  // Add image pull secret if specified
  if (config.imagePullSecret) {
    podSpec.imagePullSecrets = [{ name: config.imagePullSecret }];
  }

  // Build job spec
  const jobSpec: Record<string, unknown> = {
    template: {
      metadata: {
        labels: {
          'app.kubernetes.io/name': 'loom-agent',
          'app.kubernetes.io/instance': jobName,
          'loom.agent/target-id': target.id,
          'loom.agent/agent-type': target.agentType,
        },
      },
      spec: podSpec,
    },
    backoffLimit: 0, // Don't retry failed jobs
  };

  // Add TTL after finished if specified
  if (config.ttlSecondsAfterFinished !== undefined) {
    jobSpec.ttlSecondsAfterFinished = config.ttlSecondsAfterFinished;
  }

  // Build full manifest
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: config.namespace,
      labels: {
        'app.kubernetes.io/name': 'loom-agent',
        'app.kubernetes.io/instance': jobName,
        'app.kubernetes.io/managed-by': 'loom-weft',
        'loom.agent/target-id': target.id,
        'loom.agent/agent-type': target.agentType,
      },
      annotations: {
        'loom.agent/target-name': target.name,
        'loom.agent/created-at': new Date().toISOString(),
      },
    },
    spec: jobSpec,
  };
}

/**
 * Check if a Kubernetes job is still running
 */
export async function checkKubernetesJobStatus(
  namespace: string,
  jobName: string
): Promise<{ running: boolean; succeeded: boolean; failed: boolean }> {
  return new Promise((resolve, reject) => {
    const kubectl = spawn('kubectl', [
      'get', 'job', jobName,
      '-n', namespace,
      '-o', 'jsonpath={.status.active},{.status.succeeded},{.status.failed}',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    kubectl.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    kubectl.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    kubectl.on('error', (error) => {
      reject(new Error(`kubectl error: ${error.message}`));
    });

    kubectl.on('exit', (code) => {
      if (code === 0) {
        const [active, succeeded, failed] = stdout.split(',');
        resolve({
          running: active === '1',
          succeeded: succeeded === '1',
          failed: failed === '1',
        });
      } else {
        reject(new Error(`kubectl get job failed: ${stderr}`));
      }
    });
  });
}

/**
 * Delete a Kubernetes job
 */
export async function deleteKubernetesJob(
  namespace: string,
  jobName: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const kubectl = spawn('kubectl', [
      'delete', 'job', jobName,
      '-n', namespace,
      '--ignore-not-found=true',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    kubectl.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    kubectl.on('error', (error) => {
      reject(new Error(`kubectl error: ${error.message}`));
    });

    kubectl.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`kubectl delete job failed: ${stderr}`));
      }
    });
  });
}
