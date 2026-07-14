import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infrastructure/db/schema/database.schema.ts',
  out: './src/infrastructure/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
});
