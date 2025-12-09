import { spawn } from 'child_process';
import { hostname } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type {
  ConnectedClient,
  CoordinatedWorkItem,
  RegisteredAgent,
  WorkItemResult,
  WorkItemError,
} from '@loom/shared';
import {
  createNATSClient,
  WorkSubjects,
  AgentSubjects,
  KVBuckets,
  encodeMessage,
  decodeMessage,
} from '@loom/shared';
import type { BridgeConfig } from './config.js';
import { loadConfig, printConfig } from './config.js';
import {
  registerSelfAsTarget,
  linkAgentToTarget,
  unlinkAgentFromTarget,
} from './target-registration.js';

/**
 * Copilot Bridge - connects NATS work queue to GitHub Copilot CLI
 */
export class CopilotBridge {
  private config: BridgeConfig;
  private client?: ConnectedClient;
  private agentGuid?: string;
  private running = false;
  private currentWorkCount = 0;
  private lastActivityTime = Date.now();
  private idleCheckInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(configPath?: string) {
    this.config = loadConfig(configPath);
  }

  /**
   * Start the bridge
   */
  async start(): Promise<void> {
    printConfig(this.config);

    console.log('\n=== Starting Copilot Bridge ===\n');

    // Connect to NATS
    console.log('Connecting to NATS...');
    this.client = await createNATSClient({
      url: this.config.natsUrl,
      name: `copilot-bridge-${this.config.agentHandle}`,
    });
    console.log('  Connected to NATS');

    // Optionally register as a spin-up target
    if (this.config.registerTarget && this.config.targetName) {
      await registerSelfAsTarget(this.client, this.config.projectId, {
        targetName: this.config.targetName,
        capabilities: this.config.capabilities,
        boundaries: this.config.boundaries,
        description: `Copilot CLI bridge on ${hostname()}`,
        workingDirectory: this.config.workingDirectory,
        env: {
          ...this.config.copilotEnv,
          NATS_URL: this.config.natsUrl,
          LOOM_PROJECT_ID: this.config.projectId,
        },
      });
    }

    // Register as agent
    console.log('\nRegistering as agent...');
    this.agentGuid = await this.registerAgent();
    console.log(`  Registered with GUID: ${this.agentGuid}`);

    // Link to target if configured
    if (this.config.targetName) {
      console.log(`\nLinking to target: ${this.config.targetName}`);
      await linkAgentToTarget(
        this.client,
        this.config.projectId,
        this.config.targetName,
        this.agentGuid,
      );
      console.log('  Linked to target');
    }

    // Start work subscription
    console.log('\nSubscribing to work queues...');
    this.running = true;
    await this.subscribeToWork();
    console.log('  Subscribed to work queues');

    // Start heartbeat
    this.startHeartbeat();

    // Start idle check if timeout is set
    if (this.config.idleTimeoutMs > 0) {
      this.startIdleCheck();
      console.log(`\nIdle timeout: ${this.config.idleTimeoutMs}ms`);
    } else {
      console.log('\nIdle timeout: disabled');
    }

    // Setup graceful shutdown
    this.setupShutdownHandlers();

    console.log('\n=== Copilot Bridge Ready ===\n');
    console.log('Waiting for work...\n');
  }

  /**
   * Register as an agent with the coordinator
   */
  private async registerAgent(): Promise<string> {
    if (!this.client) throw new Error('Not connected to NATS');

    const guid = uuidv4();
    const kv = await this.client.js.views.kv(KVBuckets.agentRegistry(this.config.projectId));

    const agent: RegisteredAgent = {
      guid,
      handle: this.config.agentHandle,
      agentType: 'copilot-cli',
      status: 'online',
      capabilities: this.config.capabilities,
      boundaries: this.config.boundaries,
      hostname: hostname(),
      projectId: this.config.projectId,
      visibility: 'project-only',
      currentTaskCount: 0,
      maxConcurrentTasks: this.config.maxConcurrent,
      spindownAfterIdleMs: this.config.idleTimeoutMs,
      lastHeartbeat: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
    };

    await kv.put(guid, encodeMessage(agent));

    // Publish registration announcement
    await this.client.nc.publish(
      AgentSubjects.register(this.config.projectId),
      encodeMessage({
        guid,
        handle: agent.handle,
        agentType: agent.agentType,
        capabilities: agent.capabilities,
        timestamp: agent.registeredAt,
      }),
    );

    return guid;
  }

  /**
   * Subscribe to work queues for all capabilities
   */
  private async subscribeToWork(): Promise<void> {
    if (!this.client) throw new Error('Not connected to NATS');

    for (const capability of this.config.capabilities) {
      const subject = WorkSubjects.queue(this.config.projectId, capability);
      const sub = this.client.nc.subscribe(subject);

      (async () => {
        for await (const msg of sub) {
          if (!this.running) break;

          try {
            const workItem: CoordinatedWorkItem = decodeMessage(msg.data);
            await this.handleWorkItem(workItem);
          } catch (error) {
            console.error('Error handling work item:', error);
          }
        }
      })();

      console.log(`  Subscribed to: ${subject}`);
    }
  }

  /**
   * Handle a work item
   */
  private async handleWorkItem(workItem: CoordinatedWorkItem): Promise<void> {
    // Check if we can accept this work
    if (this.currentWorkCount >= this.config.maxConcurrent) {
      console.log(`Skipping work ${workItem.id}: at max concurrent limit`);
      return;
    }

    if (!this.config.boundaries.includes(workItem.boundary)) {
      console.log(`Skipping work ${workItem.id}: classification ${workItem.boundary} not allowed`);
      return;
    }

    console.log(`\n=== Processing Work Item ===`);
    console.log(`  ID: ${workItem.id}`);
    console.log(`  Task ID: ${workItem.taskId}`);
    console.log(`  Classification: ${workItem.boundary}`);
    console.log(`  Capability: ${workItem.capability}`);
    console.log(`  Description: ${workItem.description}`);
    console.log(`============================\n`);

    this.currentWorkCount++;
    this.lastActivityTime = Date.now();
    await this.updateAgentStatus('busy');

    try {
      // Execute copilot
      const result = await this.executeCopilot(workItem);

      // Report completion
      await this.reportCompletion(workItem, result);

      console.log(`\nWork ${workItem.id} completed successfully\n`);
    } catch (error) {
      console.error(`\nWork ${workItem.id} failed:`, error);

      // Report error
      await this.reportError(workItem, error as Error);
    } finally {
      this.currentWorkCount--;
      this.lastActivityTime = Date.now();

      if (this.currentWorkCount === 0) {
        await this.updateAgentStatus('online');
      }
    }
  }

  /**
   * Execute copilot CLI with work item
   */
  private async executeCopilot(workItem: CoordinatedWorkItem): Promise<WorkItemResult> {
    return new Promise((resolve, reject) => {
      const args: string[] = [];

      // Build prompt from work item
      let prompt = workItem.description;

      // Add context data if available
      if (workItem.contextData) {
        prompt += `\n\nContext:\n${JSON.stringify(workItem.contextData, null, 2)}`;
      }

      args.push('--prompt', prompt);

      // Allow all tools (equivalent to --allow-all-tools)
      args.push('--allow-all-tools');

      // Add agent if specified in config or context data
      const agent = (workItem.contextData?.agent as string) || this.config.copilotAgent;
      if (agent) {
        args.push('--agent', agent);
      }

      console.log(`Executing: ${this.config.copilotPath} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}\n`);

      // Spawn copilot process
      const proc = spawn(this.config.copilotPath, args, {
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.copilotEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text); // Echo to console
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text); // Echo to console
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to execute copilot: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({
            summary: `Copilot execution completed for task ${workItem.taskId}`,
            output: {
              stdout,
              stderr,
              exitCode: code,
            },
            completedAt: new Date().toISOString(),
          });
        } else {
          reject(new Error(`Copilot exited with code ${code}\n${stderr}`));
        }
      });
    });
  }

  /**
   * Report work completion
   */
  private async reportCompletion(workItem: CoordinatedWorkItem, result: WorkItemResult): Promise<void> {
    if (!this.client) return;

    await this.client.nc.publish(
      WorkSubjects.completed(this.config.projectId),
      encodeMessage({
        workItemId: workItem.id,
        taskId: workItem.taskId,
        agentGuid: this.agentGuid,
        result,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  /**
   * Report work error
   */
  private async reportError(workItem: CoordinatedWorkItem, error: Error): Promise<void> {
    if (!this.client) return;

    const workError: WorkItemError = {
      message: error.message,
      recoverable: false, // Copilot errors are generally not recoverable
      stack: error.stack,
      occurredAt: new Date().toISOString(),
    };

    await this.client.nc.publish(
      WorkSubjects.errors(this.config.projectId),
      encodeMessage({
        workItemId: workItem.id,
        taskId: workItem.taskId,
        agentGuid: this.agentGuid,
        error: workError,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  /**
   * Update agent status
   */
  private async updateAgentStatus(status: 'online' | 'busy' | 'offline'): Promise<void> {
    if (!this.client || !this.agentGuid) return;

    const kv = await this.client.js.views.kv(KVBuckets.agentRegistry(this.config.projectId));
    const entry = await kv.get(this.agentGuid);
    if (!entry) return;

    const agent: RegisteredAgent = decodeMessage(entry.value);
    agent.status = status;
    agent.currentTaskCount = this.currentWorkCount;
    agent.lastActivity = new Date().toISOString();

    await kv.put(this.agentGuid, encodeMessage(agent));
  }

  /**
   * Start heartbeat loop
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (!this.client || !this.agentGuid) return;

      try {
        const kv = await this.client.js.views.kv(KVBuckets.agentRegistry(this.config.projectId));
        const entry = await kv.get(this.agentGuid);
        if (!entry) return;

        const agent: RegisteredAgent = decodeMessage(entry.value);
        agent.lastHeartbeat = new Date().toISOString();

        await kv.put(this.agentGuid, encodeMessage(agent));
      } catch (error) {
        console.error('Heartbeat failed:', error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Start idle check loop
   */
  private startIdleCheck(): void {
    this.idleCheckInterval = setInterval(() => {
      if (this.currentWorkCount > 0) {
        // Not idle if working
        return;
      }

      const idleTime = Date.now() - this.lastActivityTime;
      if (idleTime >= this.config.idleTimeoutMs) {
        console.log(`\nIdle timeout reached (${this.config.idleTimeoutMs}ms), shutting down...\n`);
        this.shutdown('idle-timeout').catch(console.error);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdownHandler = (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...\n`);
      this.shutdown('manual').catch((error) => {
        console.error('Shutdown error:', error);
        process.exit(1);
      });
    };

    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));
  }

  /**
   * Shutdown the bridge
   */
  async shutdown(reason: 'idle-timeout' | 'manual' | 'error'): Promise<void> {
    console.log(`Shutting down (reason: ${reason})...`);

    this.running = false;

    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }

    // Wait for current work to complete
    if (this.currentWorkCount > 0) {
      console.log(`Waiting for ${this.currentWorkCount} work item(s) to complete...`);
      while (this.currentWorkCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Unlink from target
    if (this.client && this.config.targetName) {
      try {
        await unlinkAgentFromTarget(this.client, this.config.projectId, this.config.targetName);
        console.log('  Unlinked from target');
      } catch (error) {
        console.error('  Failed to unlink from target:', error);
      }
    }

    // Update agent status to offline
    if (this.client && this.agentGuid) {
      try {
        await this.updateAgentStatus('offline');
        console.log('  Agent status updated to offline');
      } catch (error) {
        console.error('  Failed to update agent status:', error);
      }
    }

    // Deregister agent
    if (this.client && this.agentGuid) {
      try {
        const kv = await this.client.js.views.kv(KVBuckets.agentRegistry(this.config.projectId));
        await kv.delete(this.agentGuid);

        await this.client.nc.publish(
          AgentSubjects.deregister(this.config.projectId),
          encodeMessage({
            guid: this.agentGuid,
            timestamp: new Date().toISOString(),
          }),
        );

        console.log('  Agent deregistered');
      } catch (error) {
        console.error('  Failed to deregister agent:', error);
      }
    }

    // Close NATS connection
    if (this.client) {
      await this.client.close();
      console.log('  NATS connection closed');
    }

    console.log('Shutdown complete');
    process.exit(0);
  }
}

/**
 * Start the bridge
 */
export async function startBridge(configPath?: string): Promise<void> {
  const bridge = new CopilotBridge(configPath);
  await bridge.start();
}
