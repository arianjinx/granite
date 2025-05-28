import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    external: ['./plugins/babel.cjs'],
  },
  {
    entry: ['src/plugins/babel.ts'],
    format: ['cjs'],
    outDir: 'dist/plugins',
    dts: false,
  },
]);
