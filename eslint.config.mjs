// dlinter-ts-react v0.9.0 integration (real test)
// The Bridge Boundary that previously lived as hand-rolled no-restricted-syntax
// selectors is now expressed as dlinter's infrastructure edge.
import { createRecommendedConfig } from 'dlinter-ts-react';

export default [
  {
    ignores: ['uniwind-types.d.ts', 'uniwind.d.ts'],
  },
  ...createRecommendedConfig({
    infrastructure: {
      importPatterns: ['(^|/)infrastructure(/|$)'],
    },
  }),
  {
    files: ['jest.config.js', 'metro.config.js', 'scripts/generate-feature.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
  },
];
