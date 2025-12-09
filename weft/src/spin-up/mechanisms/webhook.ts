import type { SpinUpTarget, SpinUpResult } from '@loom/shared';

/**
 * Spin up an agent using a webhook call
 *
 * Makes an HTTP request to a webhook URL. Supports template substitution
 * in the request body for dynamic values.
 *
 * @param target - Target configuration with webhook mechanism
 * @returns Spin-up result with webhook response
 */
export async function webhookSpinUp(target: SpinUpTarget): Promise<SpinUpResult> {
  if (target.config.mechanism !== 'webhook') {
    throw new Error(`Expected webhook mechanism, got ${target.config.mechanism}`);
  }

  const config = target.config.webhook;

  // Build request
  const method = config.method ?? 'POST';
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'loom-weft',
    ...(config.headers ?? {}),
  };

  // Build request body with template substitution
  let body: string | undefined;
  if (config.bodyTemplate) {
    body = substituteTemplate(config.bodyTemplate, {
      targetId: target.id,
      targetName: target.name,
      agentType: target.agentType,
      timestamp: new Date().toISOString(),
    });
  }

  const timeoutMs = config.timeoutMs ?? 30000;
  const successCodes = config.successCodes ?? [200, 201, 202];

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(config.url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Check if response code is in success codes
    if (!successCodes.includes(response.status)) {
      const errorText = await response.text();
      throw new Error(
        `Webhook returned unexpected status ${response.status}: ${errorText}`
      );
    }

    // Try to parse response as JSON
    let responseData: unknown;
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }
    } catch (error) {
      // Non-JSON response or parse error - that's okay
      responseData = null;
    }

    return {
      success: true,
      targetId: target.id,
      targetName: target.name,
      mechanismResult: {
        response: responseData,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Webhook request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
    throw new Error(`Webhook spin-up failed: ${String(error)}`);
  }
}

/**
 * Substitute template placeholders in a string
 *
 * Replaces {{key}} with values from the context object.
 */
function substituteTemplate(
  template: string,
  context: Record<string, string>
): string {
  let result = template;

  for (const [key, value] of Object.entries(context)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, 'g'), value);
  }

  return result;
}
