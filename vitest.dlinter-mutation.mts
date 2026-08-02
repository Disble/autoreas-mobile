import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/mutation/**/*.mutation.test.ts'],
    exclude: ['scripts/**', '**/scripts/**', '**/.dlinter-mutation-tmp/**'],
    deps: { optimizer: { client: { enabled: false }, ssr: { enabled: false } } },
  },
});
