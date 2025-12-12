/**
 * Weft REST API Client
 *
 * HTTP client for communicating with Weft coordinator REST API.
 */

import type { CLIConfiguration } from '@loom/shared';

export interface APIClientOptions {
  baseUrl: string;
  token?: string;
  timeout?: number;
}

export interface APIResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * Create API client from CLI configuration
 */
export function createAPIClient(config: CLIConfiguration): WeftAPIClient {
  const baseUrl = config.apiUrl || 'http://localhost:3000';
  return new WeftAPIClient({
    baseUrl,
    token: config.apiToken,
    timeout: 30000,
  });
}

/**
 * Weft REST API Client
 */
export class WeftAPIClient {
  private baseUrl: string;
  private token?: string;
  private timeout: number;

  constructor(options: APIClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.token = options.token;
    this.timeout = options.timeout || 30000;
  }

  /**
   * Make an HTTP request to the Weft API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<APIResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type');
      let data: T | undefined;

      if (contentType?.includes('application/json')) {
        data = await response.json() as T;
      }

      if (!response.ok) {
        const errorMessage = (data as any)?.error || (data as any)?.message || response.statusText;
        return {
          ok: false,
          status: response.status,
          error: errorMessage,
        };
      }

      return {
        ok: true,
        status: response.status,
        data,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        return {
          ok: false,
          status: 0,
          error: `Request timeout after ${this.timeout}ms`,
        };
      }

      return {
        ok: false,
        status: 0,
        error: err.message || 'Network error',
      };
    }
  }

  // ============ Health ============

  async health(): Promise<APIResponse<{ status: string }>> {
    return this.request('GET', '/health');
  }

  // ============ Agents ============

  async listAgents(filter?: {
    type?: string;
    status?: string;
    capability?: string;
  }): Promise<APIResponse<{ agents: any[]; count: number }>> {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.status) params.set('status', filter.status);
    if (filter?.capability) params.set('capability', filter.capability);

    const query = params.toString();
    return this.request('GET', `/api/agents${query ? `?${query}` : ''}`);
  }

  async getAgent(guid: string): Promise<APIResponse<any>> {
    return this.request('GET', `/api/agents/${guid}`);
  }

  async shutdownAgent(
    guid: string,
    graceful = true
  ): Promise<APIResponse<{ success: boolean; message: string }>> {
    return this.request('POST', `/api/agents/${guid}/shutdown`, { graceful });
  }

  // ============ Work ============

  async listWork(filter?: {
    status?: string;
    classification?: string;
  }): Promise<APIResponse<{ workItems: any[]; count: number }>> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.classification) params.set('classification', filter.classification);

    const query = params.toString();
    return this.request('GET', `/api/work${query ? `?${query}` : ''}`);
  }

  async getWork(id: string): Promise<APIResponse<any>> {
    return this.request('GET', `/api/work/${id}`);
  }

  async submitWork(work: {
    description: string;
    boundary: string;
    capability: string;
    priority?: number;
    taskId?: string;
    deadline?: string;
    contextData?: Record<string, unknown>;
  }): Promise<APIResponse<any>> {
    return this.request('POST', '/api/work', work);
  }

  async cancelWork(
    id: string
  ): Promise<APIResponse<{ success: boolean; message: string }>> {
    return this.request('POST', `/api/work/${id}/cancel`);
  }

  // ============ Targets ============

  async listTargets(filter?: {
    type?: string;
    status?: string;
    capability?: string;
    classification?: string;
  }): Promise<APIResponse<{ targets: any[]; count: number }>> {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.status) params.set('status', filter.status);
    if (filter?.capability) params.set('capability', filter.capability);
    if (filter?.classification) params.set('classification', filter.classification);

    const query = params.toString();
    return this.request('GET', `/api/targets${query ? `?${query}` : ''}`);
  }

  async getTarget(idOrName: string): Promise<APIResponse<any>> {
    return this.request('GET', `/api/targets/${encodeURIComponent(idOrName)}`);
  }

  async createTarget(target: {
    name: string;
    agentType: string;
    capabilities: string[];
    mechanism: string;
    config: any;
    boundaries?: string[];
    description?: string;
    tags?: string[];
  }): Promise<APIResponse<any>> {
    return this.request('POST', '/api/targets', target);
  }

  async updateTarget(
    idOrName: string,
    updates: Record<string, unknown>
  ): Promise<APIResponse<any>> {
    return this.request('PUT', `/api/targets/${encodeURIComponent(idOrName)}`, updates);
  }

  async deleteTarget(
    idOrName: string
  ): Promise<APIResponse<{ success: boolean; message: string }>> {
    return this.request('DELETE', `/api/targets/${encodeURIComponent(idOrName)}`);
  }

  async testTarget(idOrName: string): Promise<APIResponse<any>> {
    return this.request('POST', `/api/targets/${encodeURIComponent(idOrName)}/test`);
  }

  async spinUpTarget(idOrName: string): Promise<APIResponse<any>> {
    return this.request('POST', `/api/targets/${encodeURIComponent(idOrName)}/spin-up`);
  }

  async enableTarget(
    idOrName: string
  ): Promise<APIResponse<{ success: boolean; message: string }>> {
    return this.request('POST', `/api/targets/${encodeURIComponent(idOrName)}/enable`);
  }

  async disableTarget(
    idOrName: string
  ): Promise<APIResponse<{ success: boolean; message: string }>> {
    return this.request('POST', `/api/targets/${encodeURIComponent(idOrName)}/disable`);
  }

  // ============ Stats ============

  async getStats(): Promise<APIResponse<any>> {
    return this.request('GET', '/api/stats');
  }

  async listProjects(): Promise<APIResponse<{ projects: string[]; count: number }>> {
    return this.request('GET', '/api/stats/projects');
  }

  // ============ Channels ============

  async listChannels(
    projectId: string
  ): Promise<APIResponse<{ channels: { name: string; description?: string }[]; count: number }>> {
    return this.request('GET', `/api/channels?projectId=${encodeURIComponent(projectId)}`);
  }

  async readChannelMessages(
    projectId: string,
    channelName: string,
    limit = 50
  ): Promise<APIResponse<{ channel: string; messages: { timestamp: string; handle: string; message: string }[]; count: number }>> {
    const params = new URLSearchParams({
      projectId,
      limit: String(limit),
    });
    return this.request('GET', `/api/channels/${encodeURIComponent(channelName)}/messages?${params}`);
  }
}
