import { defineConfig } from 'tsup';
import { packageVersionDefines } from './package-versions.config';

export default defineConfig({
  entry: ['src/cli.ts'],
  define: packageVersionDefines,
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
