/**
 * @file File watching utilities
 */

import { watch, type FSWatcher } from 'chokidar';
import pc from 'picocolors';

export interface WatchOptions {
  patterns: string[];
  onAdd?: (path: string) => void;
  onChange?: (path: string) => void;
  onUnlink?: (path: string) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Create a file watcher
 */
export function createWatcher(options: WatchOptions): FSWatcher {
  const watcher = watch(options.patterns, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  });

  watcher.on('add', (path) => {
    options.onAdd?.(path);
  });

  watcher.on('change', (path) => {
    options.onChange?.(path);
  });

  watcher.on('unlink', (path) => {
    options.onUnlink?.(path);
  });

  watcher.on('ready', () => {
    options.onReady?.();
  });

  watcher.on('error', (error) => {
    options.onError?.(error);
  });

  return watcher;
}

/**
 * Format a watch event for display
 */
export function formatWatchEvent(type: 'add' | 'change' | 'unlink', path: string): string {
  const icons = {
    add: pc.green('+'),
    change: pc.yellow('~'),
    unlink: pc.red('-'),
  };
  return `${icons[type]} ${path}`;
}
