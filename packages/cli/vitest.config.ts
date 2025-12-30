import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli.ts',           // Entry point
        'src/index.ts',         // Exports
        'src/types.ts',         // Type definitions
        'src/**/*.d.ts',        // Type definitions
        'src/templates/**',     // Template files
        'src/commands/**',      // CLI commands (tested via integration)
        'src/preview/**',       // Preview server (tested via integration)
        'src/lib/watcher.ts',   // File watcher (tested via integration)
        'src/lib/logger.ts',    // Logger wrapper
        'src/lib/config-loader.ts', // Config loader (tested via integration)
        'src/lib/template-engine.ts', // Template engine (tested via init command)
        'src/lib/cache.ts',     // Cache (tested via integration)
        'src/lib/formatter-vscode.ts', // VSCode formatter (tested via integration)
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
