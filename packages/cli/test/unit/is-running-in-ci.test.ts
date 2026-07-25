import { describe, it, expect, afterEach } from 'vitest';
import { isRunningInCI } from '../../src/commands/validate.js';

const ORIGINAL_CI = process.env.CI;

function setCI(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = value;
  }
}

describe('isRunningInCI', () => {
  afterEach(() => {
    setCI(ORIGINAL_CI);
  });

  it('treats truthy CI values as in-CI', () => {
    for (const value of ['true', '1', 'yes', 'TRUE', 'True']) {
      setCI(value);
      expect(isRunningInCI()).toBe(true);
    }
  });

  it('treats falsy CI values as NOT in-CI (case-insensitive)', () => {
    // The bug: `CI=False`/`CI=FALSE`/`CI=No` were treated as truthy.
    for (const value of ['', '0', 'false', 'False', 'FALSE', 'no', 'No', 'off', 'OFF']) {
      setCI(value);
      expect(isRunningInCI()).toBe(false);
    }
  });

  it('treats an unset CI variable as NOT in-CI', () => {
    setCI(undefined);
    expect(isRunningInCI()).toBe(false);
  });
});
