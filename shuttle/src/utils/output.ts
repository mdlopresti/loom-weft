/**
 * Output formatting utilities
 * Handles table and JSON output with colors
 */

import chalk from 'chalk';
import Table from 'cli-table3';

export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}

/**
 * Print output as table or JSON
 */
export function output(data: any, options: OutputOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!options.quiet) {
    console.log(data);
  }
}

/**
 * Print success message
 */
export function success(message: string, options: OutputOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ success: true, message }));
  } else if (!options.quiet) {
    console.log(chalk.green('✓'), message);
  }
}

/**
 * Print error message
 */
export function error(message: string, options: OutputOptions = {}): void {
  if (options.json) {
    console.error(JSON.stringify({ success: false, error: message }));
  } else {
    console.error(chalk.red('✗'), message);
  }
}

/**
 * Print warning message
 */
export function warning(message: string, options: OutputOptions = {}): void {
  if (options.json) {
    console.warn(JSON.stringify({ warning: message }));
  } else if (!options.quiet) {
    console.warn(chalk.yellow('⚠'), message);
  }
}

/**
 * Print info message
 */
export function info(message: string, options: OutputOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ info: message }));
  } else if (!options.quiet) {
    console.log(chalk.blue('ℹ'), message);
  }
}

/**
 * Create a table with headers and rows
 */
export function createTable(headers: string[], rows: string[][]): Table.Table {
  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: {
      head: [],
      border: ['grey'],
    },
  });

  rows.forEach((row) => table.push(row));
  return table;
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return 'N/A';

  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}

/**
 * Format duration in milliseconds to human readable
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return 'N/A';

  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);

  if (sec < 60) return `${sec}s`;
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${hour}h ${min % 60}m`;
}

/**
 * Color status text
 */
export function colorStatus(status: string): string {
  switch (status.toLowerCase()) {
    case 'online':
    case 'available':
    case 'healthy':
    case 'completed':
      return chalk.green(status);
    case 'busy':
    case 'in-progress':
    case 'assigned':
    case 'in-use':
      return chalk.yellow(status);
    case 'offline':
    case 'disabled':
    case 'failed':
    case 'error':
    case 'unhealthy':
      return chalk.red(status);
    case 'pending':
    case 'unknown':
      return chalk.gray(status);
    default:
      return status;
  }
}

/**
 * Color agent type
 */
export function colorAgentType(type: string): string {
  switch (type) {
    case 'claude-code':
      return chalk.magenta(type);
    case 'copilot-cli':
      return chalk.cyan(type);
    default:
      return type;
  }
}

/**
 * Color boundary name
 */
export function colorBoundary(boundary: string): string {
  // Use consistent color for user-defined boundaries
  return chalk.magenta(boundary);
}

/**
 * Truncate text to a max length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Format a list as bullet points
 */
export function formatList(items: string[]): string {
  return items.map((item) => `  • ${item}`).join('\n');
}

/**
 * Format key-value pairs
 */
export function formatKeyValue(data: Record<string, any>): string {
  const maxKeyLength = Math.max(...Object.keys(data).map((k) => k.length));
  return Object.entries(data)
    .map(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLength);
      return `  ${chalk.cyan(paddedKey)}: ${value}`;
    })
    .join('\n');
}
