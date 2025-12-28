/**
 * @file Logging utilities
 */

import consola, { type ConsolaInstance } from 'consola';
import pc from 'picocolors';

// Create a custom consola instance
export const logger: ConsolaInstance = consola.create({
  formatOptions: {
    date: false,
  },
});

/**
 * Log a success message
 */
export function success(message: string): void {
  logger.success(message);
}

/**
 * Log an error message
 */
export function error(message: string, err?: Error): void {
  logger.error(message);
  if (err?.stack && process.env.DEBUG) {
    console.error(pc.dim(err.stack));
  }
}

/**
 * Log a warning message
 */
export function warn(message: string): void {
  logger.warn(message);
}

/**
 * Log an info message
 */
export function info(message: string): void {
  logger.info(message);
}

/**
 * Log a debug message (only in DEBUG mode)
 */
export function debug(message: string): void {
  if (process.env.DEBUG) {
    logger.debug(message);
  }
}

/**
 * Create a spinner for long-running operations
 */
export function createSpinner(message: string) {
  return {
    start() {
      logger.start(message);
    },
    stop(finalMessage?: string) {
      if (finalMessage) {
        logger.success(finalMessage);
      }
    },
    fail(errorMessage: string) {
      logger.fail(errorMessage);
    },
  };
}

/**
 * Print a boxed message
 */
export function box(message: string): void {
  logger.box(message);
}
