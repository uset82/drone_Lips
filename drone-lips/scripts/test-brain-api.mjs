import 'dotenv/config';

import { spawn } from 'node:child_process';

async function killChild(child) {
  if (!child?.pid) return;

  if (process.platform === 'win32') {
    // SIGINT/SIGTERM are unreliable on Windows when spawned via a shell.
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: true,
      });
      killer.on('exit', resolve);
    });
    await sleep(150);
    return;
  }

  child.kill('SIGINT');
  await sleep(300);
  child.kill('SIGTERM');
}

const host = process.env.AUGGIE_SERVER_HOST || '127.0.0.1';
const port = Number(process.env.AUGGIE_SERVER_PORT || 4546);

const baseUrl = `http://${host}:${port}`;
const healthUrl = `${baseUrl}/health`;
const chatUrl = `${baseUrl}/api/auggie/chat`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isHealthy() {
  try {
    const res = await fetch(healthUrl);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isHealthy()) return { child: null };

  const child = spawn('node', ['scripts/auggie-server.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });

  // Wait until /health is up.
  for (let i = 0; i < 40; i += 1) {
    await sleep(200);
    if (await isHealthy()) return { child };
  }

  child.kill();
  throw new Error('Local brain server did not become healthy in time.');
}

try {
  const { child } = await ensureServer();

  try {
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Respond with a short confirmation that the chat API is working.',
        mode: 'chat',
      }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      console.error(`[test-brain-api] failed: ${res.status}`);
      console.error(json);
      process.exit(1);
    }

    console.log('[test-brain-api] ok');
    console.log(json?.message);
  } finally {
    if (child) {
      await killChild(child);
    }
  }
} catch (err) {
  console.error('[test-brain-api] error');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
