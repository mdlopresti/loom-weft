/**
 * Tests for output formatting utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  output,
  success,
  error,
  warning,
  info,
  formatTimestamp,
  formatDuration,
  colorStatus,
  colorAgentType,
  colorBoundary,
  truncate,
  formatList,
  formatKeyValue,
  createTable,
} from '../utils/output.js';

describe('Output Utilities', () => {
  let consoleLogs: string[];
  let consoleErrors: string[];
  let consoleWarns: string[];

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  beforeEach(() => {
    consoleLogs = [];
    consoleErrors = [];
    consoleWarns = [];
    console.log = (...args) => consoleLogs.push(args.join(' '));
    console.error = (...args) => consoleErrors.push(args.join(' '));
    console.warn = (...args) => consoleWarns.push(args.join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  describe('output', () => {
    it('should output data directly', () => {
      output('test data');
      expect(consoleLogs).toContain('test data');
    });

    it('should output as JSON when json option is true', () => {
      output({ key: 'value' }, { json: true });
      expect(consoleLogs[0]).toBe(JSON.stringify({ key: 'value' }, null, 2));
    });

    it('should not output when quiet option is true', () => {
      output('test data', { quiet: true });
      expect(consoleLogs).toHaveLength(0);
    });
  });

  describe('success', () => {
    it('should print success message with checkmark', () => {
      success('Test passed');
      expect(consoleLogs.some((l) => l.includes('Test passed'))).toBe(true);
    });

    it('should output as JSON when json option is true', () => {
      success('Test passed', { json: true });
      expect(consoleLogs[0]).toBeDefined();
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed).toEqual({ success: true, message: 'Test passed' });
    });
  });

  describe('error', () => {
    it('should print error message', () => {
      error('Test failed');
      expect(consoleErrors.some((l) => l.includes('Test failed'))).toBe(true);
    });

    it('should output as JSON when json option is true', () => {
      error('Test failed', { json: true });
      expect(consoleErrors[0]).toBeDefined();
      const parsed = JSON.parse(consoleErrors[0]!);
      expect(parsed).toEqual({ success: false, error: 'Test failed' });
    });
  });

  describe('warning', () => {
    it('should print warning message', () => {
      warning('Test warning');
      expect(consoleWarns.some((l) => l.includes('Test warning'))).toBe(true);
    });

    it('should output as JSON when json option is true', () => {
      warning('Test warning', { json: true });
      expect(consoleWarns[0]).toBeDefined();
      const parsed = JSON.parse(consoleWarns[0]!);
      expect(parsed).toEqual({ warning: 'Test warning' });
    });
  });

  describe('info', () => {
    it('should print info message', () => {
      info('Test info');
      expect(consoleLogs.some((l) => l.includes('Test info'))).toBe(true);
    });

    it('should output as JSON when json option is true', () => {
      info('Test info', { json: true });
      expect(consoleLogs[0]).toBeDefined();
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed).toEqual({ info: 'Test info' });
    });
  });

  describe('formatTimestamp', () => {
    it('should return N/A for undefined', () => {
      expect(formatTimestamp(undefined)).toBe('N/A');
    });

    it('should show seconds ago for recent times', () => {
      const now = new Date();
      now.setSeconds(now.getSeconds() - 30);
      expect(formatTimestamp(now.toISOString())).toBe('30s ago');
    });

    it('should show minutes ago', () => {
      const now = new Date();
      now.setMinutes(now.getMinutes() - 5);
      expect(formatTimestamp(now.toISOString())).toBe('5m ago');
    });

    it('should show hours ago', () => {
      const now = new Date();
      now.setHours(now.getHours() - 3);
      expect(formatTimestamp(now.toISOString())).toBe('3h ago');
    });

    it('should show days ago', () => {
      const now = new Date();
      now.setDate(now.getDate() - 2);
      expect(formatTimestamp(now.toISOString())).toBe('2d ago');
    });

    it('should show date for old timestamps', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);
      const result = formatTimestamp(oldDate.toISOString());
      // Should be a date string, not "Xd ago"
      expect(result).not.toContain('ago');
    });
  });

  describe('formatDuration', () => {
    it('should return N/A for undefined', () => {
      expect(formatDuration(undefined)).toBe('N/A');
    });

    it('should format seconds', () => {
      expect(formatDuration(30000)).toBe('30s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3725000)).toBe('1h 2m');
    });
  });

  describe('colorStatus', () => {
    it('should color online status green', () => {
      const result = colorStatus('online');
      // chalk adds escape codes, just verify it returns something
      expect(result).toBeTruthy();
    });

    it('should handle busy status', () => {
      const result = colorStatus('busy');
      expect(result).toBeTruthy();
    });

    it('should handle offline status', () => {
      const result = colorStatus('offline');
      expect(result).toBeTruthy();
    });

    it('should return unknown status as-is', () => {
      const result = colorStatus('some-unknown-status');
      expect(result).toBe('some-unknown-status');
    });
  });

  describe('colorAgentType', () => {
    it('should color claude-code', () => {
      const result = colorAgentType('claude-code');
      expect(result).toBeTruthy();
    });

    it('should color copilot-cli', () => {
      const result = colorAgentType('copilot-cli');
      expect(result).toBeTruthy();
    });

    it('should return unknown types as-is', () => {
      const result = colorAgentType('unknown-type');
      expect(result).toBe('unknown-type');
    });
  });

  describe('colorBoundary', () => {
    it('should color boundaries', () => {
      const result = colorBoundary('personal');
      expect(result).toBeTruthy();
    });
  });

  describe('truncate', () => {
    it('should not truncate short text', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('should truncate long text with ellipsis', () => {
      expect(truncate('hello world this is long', 10)).toBe('hello w...');
    });

    it('should handle edge case of exactly max length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });
  });

  describe('formatList', () => {
    it('should format items as bullet points', () => {
      const result = formatList(['item1', 'item2', 'item3']);
      expect(result).toContain('• item1');
      expect(result).toContain('• item2');
      expect(result).toContain('• item3');
    });

    it('should handle empty list', () => {
      const result = formatList([]);
      expect(result).toBe('');
    });
  });

  describe('formatKeyValue', () => {
    it('should format key-value pairs', () => {
      const result = formatKeyValue({
        name: 'test',
        value: 123,
      });
      expect(result).toContain('name');
      expect(result).toContain('test');
      expect(result).toContain('value');
      expect(result).toContain('123');
    });
  });

  describe('createTable', () => {
    it('should create a table with headers and rows', () => {
      const table = createTable(['Name', 'Value'], [
        ['foo', '1'],
        ['bar', '2'],
      ]);
      // cli-table3 returns an object with toString()
      expect(table).toBeDefined();
      expect(typeof table.toString()).toBe('string');
    });
  });
});
