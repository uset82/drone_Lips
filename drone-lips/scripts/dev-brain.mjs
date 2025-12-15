import 'dotenv/config';

import { spawn } from 'node:child_process';
import net from 'node:net';

const npmCmd = 'npm';

async function isPortFree(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickPort(host, desiredPort) {
  const start = Number.isFinite(desiredPort) ? desiredPort : 4546;

  // Try the desired port first, then a small range.
  const candidates = [start];
  for (let p = 4546; p <= 4560; p += 1) {
    if (p !== start) candidates.push(p);
  }

  for (const p of candidates) {
    if (await isPortFree(host, p)) return p;
  }

  throw new Error('[dev:brain] No free AUGGIE_SERVER_PORT found (tried 4546-4560).');
}

function run(command, args, env) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[dev:brain] process exited with code ${code}: ${command} ${args.join(' ')}`);
    }
  });

  return child;
}

function killProc(p) {
  if (!p?.pid) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: true,
    });
    return;
  }

  p.kill('SIGINT');
}

const wantsHost = process.argv.includes('--host');
const devScript = wantsHost ? 'dev:ui:host' : 'dev:ui';

const host = process.env.AUGGIE_SERVER_HOST || '127.0.0.1';
const desiredPort = Number(process.env.AUGGIE_SERVER_PORT || 4546);

const port = await pickPort(host, desiredPort);

if (port !== desiredPort) {
  console.warn(
    `[dev:brain] Wanted AUGGIE_SERVER_PORT=${desiredPort} but it was unavailable. Using ${port} instead.`,
  );
}

const sharedEnv = {
  ...process.env,
  AUGGIE_SERVER_HOST: host,
  AUGGIE_SERVER_PORT: String(port),
};

const procs = [
  run(npmCmd, ['run', 'auggie:server'], sharedEnv),
  run(npmCmd, ['run', devScript], sharedEnv),
];

const shutdown = () => {
  for (const p of procs) {
    killProc(p);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
