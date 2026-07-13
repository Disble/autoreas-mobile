// dlinter-ts-react v0.5.0 integration (real test)
// The Bridge Boundary that previously lived as hand-rolled no-restricted-syntax
// selectors is now expressed as dlinter's infrastructure edge.
import { createRecommendedConfig } from 'dlinter-ts-react';

export default [
  ...createRecommendedConfig({
    infrastructure: {
      importPatterns: ['(^|/)infrastructure(/|$)'],
    },
  }),
];
