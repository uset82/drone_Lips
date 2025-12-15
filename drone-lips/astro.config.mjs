// @ts-check
import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';

import react from '@astrojs/react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'astro/config';

const keyPath = path.resolve('certs/dev-key.pem');
const certPath = path.resolve('certs/dev-cert.pem');

const https =
  fs.existsSync(keyPath) && fs.existsSync(certPath)
    ? {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      }
    : undefined;

const auggieHost = process.env.AUGGIE_SERVER_HOST || '127.0.0.1';
const auggiePort = Number(process.env.AUGGIE_SERVER_PORT || 4546);

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: https ? [] : [basicSsl()],
    server: {
      https,
      proxy: {
        // Dev-only helper: start `npm run auggie:server` and the UI can call /api/auggie/chat.
        '/api/auggie': {
          target: `http://${auggieHost}:${auggiePort}`,
          changeOrigin: true,
        },
      },
    },
  },
});
