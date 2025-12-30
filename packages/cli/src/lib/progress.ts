/**
 * @file Progress indicator for batch operations
 */

import pc from 'picocolors';

export interface ProgressOptions {
  total: number;
  label?: string;
}

export function createProgress(options: ProgressOptions) {
  let current = 0;
  const { total, label = 'Processing' } = options;

  const update = (increment = 1) => {
    current += increment;
    const pct = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));

    process.stdout.write(`\r${pc.cyan(label)} [${bar}] ${pct}% (${current}/${total})`);
  };

  const done = (message?: string) => {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
    if (message) {
      console.log(pc.green('✓'), message);
    }
  };

  return { update, done };
}
