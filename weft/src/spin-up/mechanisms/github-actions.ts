import type { SpinUpTarget, SpinUpResult } from '@loom/shared';

/**
 * Spin up an agent using GitHub Actions workflow dispatch
 *
 * Triggers a GitHub Actions workflow via the API.
 * Requires GITHUB_TOKEN environment variable (or custom token env var).
 *
 * @param target - Target configuration with GitHub Actions mechanism
 * @returns Spin-up result with workflow run information
 */
export async function githubActionsSpinUp(target: SpinUpTarget): Promise<SpinUpResult> {
  if (target.config.mechanism !== 'github-actions') {
    throw new Error(`Expected github-actions mechanism, got ${target.config.mechanism}`);
  }

  const config = target.config.githubActions;

  // Get GitHub token from environment
  const tokenEnvVar = config.tokenEnvVar ?? 'GITHUB_TOKEN';
  const token = process.env[tokenEnvVar];
  if (!token) {
    throw new Error(`GitHub token not found in environment variable ${tokenEnvVar}`);
  }

  // Parse repo (owner/repo format)
  const [owner, repo] = config.repo.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repo format: ${config.repo} (expected: owner/repo)`);
  }

  // Build workflow dispatch request
  const ref = config.ref ?? 'main';
  const inputs = config.inputs ?? {};

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${config.workflow}/dispatches`;

  const body = {
    ref,
    inputs,
  };

  try {
    // Make API request
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'loom-weft',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitHub API error (${response.status}): ${errorText}`
      );
    }

    // Workflow dispatch returns 204 No Content on success
    // We don't get the run ID back directly, but we can try to find it
    let runId: number | undefined;

    // Wait a moment for the workflow to appear
    const startTimeout = config.startTimeoutMs ?? 5000;
    await new Promise((resolve) => setTimeout(resolve, Math.min(startTimeout, 2000)));

    // Try to get the most recent run
    try {
      const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${config.workflow}/runs`;
      const runsResponse = await fetch(runsUrl, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'loom-weft',
        },
      });

      if (runsResponse.ok) {
        const runsData = await runsResponse.json() as { workflow_runs?: Array<{ id: number; created_at: string }> };
        const runs = runsData.workflow_runs;
        if (runs && runs.length > 0 && runs[0]) {
          // Get the most recent run (they're sorted by created_at DESC)
          runId = runs[0].id;
        }
      }
    } catch (error) {
      // Non-critical error - we can still report success
      console.warn('Failed to fetch workflow run ID:', error);
    }

    return {
      success: true,
      targetId: target.id,
      targetName: target.name,
      mechanismResult: {
        runId,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`GitHub Actions spin-up failed: ${String(error)}`);
  }
}
