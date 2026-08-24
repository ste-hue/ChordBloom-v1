import path from 'node:path';
import {cloudflareTest, readD1Migrations} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
      return {
        wrangler: {configPath: './wrangler.jsonc'},
        // Test-only binding values; production vars/secrets stay placeholders in wrangler.jsonc.
        miniflare: {bindings: {
          TEST_MIGRATIONS: migrations,
          LS_WEBHOOK_SECRET: 'test-secret',
          LS_STORE_ID: '4242',
          PRODUCT_CREDITS: '{"111": 100}'
        }}
      };
    })
  ],
  test: {setupFiles: ['./test/apply-migrations.js']}
});
