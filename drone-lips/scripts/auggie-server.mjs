import 'dotenv/config';

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const HOST = process.env.AUGGIE_SERVER_HOST || '127.0.0.1';
const PORT = Number(process.env.AUGGIE_SERVER_PORT || 4546);

const OPENROUTER_API_URL =
  process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'nex-agi/deepseek-v3.1-nex-n1:free';

const REPO_ROOT = process.cwd();

const DISALLOWED_PATH_PREFIXES = [
  'node_modules',
  'dist',
  '.git',
  path.join('public', 'mediapipe', 'wasm'),
];

function normalizeRelPath(relPath) {
  return String(relPath).replaceAll('\\\\', '/');
}

function isDisallowed(relPath) {
  const rel = normalizeRelPath(relPath).toLowerCase();
  return DISALLOWED_PATH_PREFIXES.some((p) => {
    const pp = normalizeRelPath(p).toLowerCase();
    return rel === pp || rel.startsWith(`${pp}/`);
  });
}

function resolveRepoPath(userPath) {
  if (typeof userPath !== 'string' || userPath.trim() === '') {
    throw new Error('Invalid path.');
  }

  const resolved = path.resolve(REPO_ROOT, userPath);
  const rel = path.relative(REPO_ROOT, resolved);
  const relParts = rel.split(path.sep);

  if (relParts[0] === '..') {
    throw new Error('Path escapes repo root.');
  }

  if (isDisallowed(rel)) {
    throw new Error('Path not allowed.');
  }

  return { resolved, rel: normalizeRelPath(rel) };
}

async function tryReadRulesText() {
  try {
    const rulesPath = path.resolve(REPO_ROOT, 'auggie.rules.md');
    return await fs.readFile(rulesPath, 'utf8');
  } catch {
    return '';
  }
}

function systemPrompt(mode, rulesText) {
  const base = [
    'You are a helpful assistant embedded in the `drone-lips` repository (Astro + React Three Fiber + MediaPipe).',
    'Be concise and practical.',
  ];

  if (rulesText.trim()) {
    base.push('\nRepo rules:\n' + rulesText.trim());
  }

  if (mode === 'brain') {
    base.push(
      '\nBrain mode: you may inspect and modify the repository using the provided tools.',
      '- Only touch files inside the repo root.',
      '- Do not modify node_modules/, dist/, .git/, or public/mediapipe/wasm/.',
      '- Prefer replace_in_file over write_file when possible.',
      '- After making changes, summarize what changed and which files were modified.',
    );
  }

  return base.join('\n');
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auggie-Session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  return JSON.parse(raw);
}

function looksLikePlaceholderKey(key) {
  const k = String(key || '').trim();
  return !k || k.includes('...') || k.length < 30;
}

async function openrouterChat({ messages, tools }) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('Missing OPENROUTER_API_KEY (set it in .env).');
  }

  if (looksLikePlaceholderKey(OPENROUTER_API_KEY)) {
    throw new Error(
      'OPENROUTER_API_KEY looks like a placeholder (e.g. "sk-or-..."). Put a real key in .env and restart `npm run dev:brain:host`.',
    );
  }

  const body = {
    model: OPENROUTER_MODEL,
    messages,
    temperature: 0.2,
    tools: tools ?? undefined,
    tool_choice: tools ? 'auto' : undefined,
  };

  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      // Optional but recommended by OpenRouter.
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'drone-lips',
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      const upstream = json?.error?.message || json?.message;
      const suffix = upstream ? ` (${upstream})` : '';
      throw new Error(
        `OpenRouter auth failed${suffix}. Set OPENROUTER_API_KEY in .env (sk-or-v1-...), then restart \`npm run dev:brain:host\`.`,
      );
    }

    const msg =
      json?.error?.message || json?.message || `OpenRouter request failed (${resp.status})`;
    throw new Error(msg);
  }

  const msg = json?.choices?.[0]?.message;
  if (!msg) throw new Error('Bad response from OpenRouter.');
  return msg;
}

const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in the repo (relative paths).',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Directory to list (relative to repo root).' },
          maxFiles: {
            type: 'integer',
            description: 'Maximum number of files to return.',
            default: 200,
          },
          maxDepth: { type: 'integer', description: 'Maximum recursion depth.', default: 6 },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the repo.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative to repo root).' },
          maxBytes: {
            type: 'integer',
            description: 'Max bytes to return (truncates if bigger).',
            default: 200_000,
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a UTF-8 text file in the repo (overwrites existing content).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative to repo root).' },
          content: { type: 'string', description: 'New full file contents.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description:
        'Replace an exact string in a file. Safer than overwriting the whole file. Fails if the search string is not found.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative to repo root).' },
          search: { type: 'string', description: 'Exact string to search for.' },
          replace: { type: 'string', description: 'Replacement string.' },
          expectedReplacements: {
            type: 'integer',
            description: 'If provided, the replacement count must match.',
          },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
];

async function tool_list_files({ directory = '.', maxFiles = 200, maxDepth = 6 } = {}) {
  const { resolved: startDir } = resolveRepoPath(directory);

  const out = [];
  const queue = [{ dir: startDir, depth: 0 }];

  while (queue.length > 0 && out.length < maxFiles) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) continue;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = normalizeRelPath(path.relative(REPO_ROOT, full));

      if (isDisallowed(rel)) continue;

      if (entry.isDirectory()) {
        queue.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        out.push(rel);
        if (out.length >= maxFiles) break;
      }
    }
  }

  return { files: out };
}

async function tool_read_file({ path: userPath, maxBytes = 200_000 }) {
  const { resolved, rel } = resolveRepoPath(userPath);

  const buf = await fs.readFile(resolved);
  const truncated = buf.length > maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;

  return {
    path: rel,
    truncated,
    bytes: buf.length,
    content: slice.toString('utf8'),
  };
}

async function tool_write_file({ path: userPath, content }) {
  const { resolved, rel } = resolveRepoPath(userPath);

  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, String(content), 'utf8');

  return { path: rel, ok: true };
}

async function tool_replace_in_file({ path: userPath, search, replace, expectedReplacements }) {
  const { resolved, rel } = resolveRepoPath(userPath);

  const before = await fs.readFile(resolved, 'utf8');
  const count = before.split(String(search)).length - 1;

  if (count <= 0) {
    throw new Error('Search string not found.');
  }

  if (typeof expectedReplacements === 'number' && expectedReplacements !== count) {
    throw new Error(`Expected ${expectedReplacements} replacements, found ${count}.`);
  }

  const after = before.replaceAll(String(search), String(replace));
  await fs.writeFile(resolved, after, 'utf8');

  return { path: rel, ok: true, replacements: count };
}

async function executeToolCall(call) {
  const name = call?.function?.name;
  const rawArgs = call?.function?.arguments;

  let args;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    args = {};
  }

  switch (name) {
    case 'list_files':
      return tool_list_files(args);
    case 'read_file':
      return tool_read_file(args);
    case 'write_file':
      return tool_write_file(args);
    case 'replace_in_file':
      return tool_replace_in_file(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function normalizeIncomingMessages(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt : null;
  if (prompt) return [{ role: 'user', content: prompt }];

  const messages = Array.isArray(body?.messages) ? body.messages : [];

  return messages
    .filter(
      (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    )
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content }));
}

async function handleChat(body) {
  const mode = body?.mode === 'brain' ? 'brain' : 'chat';
  const userMessages = normalizeIncomingMessages(body);
  if (userMessages.length === 0) {
    return { ok: false, status: 400, error: 'Missing `prompt` or `messages`.' };
  }

  const rulesText = await tryReadRulesText();

  const messages = [
    {
      role: 'system',
      content: systemPrompt(mode, rulesText),
    },
    ...userMessages,
  ];

  if (mode === 'chat') {
    const msg = await openrouterChat({ messages });
    const text = typeof msg?.content === 'string' ? msg.content : '';
    return { ok: true, status: 200, message: text };
  }

  // Brain mode: tool loop.
  const maxSteps = 8;
  const working = [...messages];

  for (let step = 0; step < maxSteps; step += 1) {
    const msg = await openrouterChat({ messages: working, tools: TOOL_DEFS });
    working.push(msg);

    const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    if (toolCalls.length === 0) {
      const text = typeof msg?.content === 'string' ? msg.content : '';
      return { ok: true, status: 200, message: text };
    }

    for (const call of toolCalls) {
      const result = await executeToolCall(call);
      working.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    ok: true,
    status: 200,
    message: 'Brain mode reached the step limit. Please refine the request or try again.',
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, {});
    }

    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/api/auggie/chat') {
      const body = await readJson(req);
      const result = await handleChat(body);
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, 200, { message: result.message });
    }

    return sendJson(res, 404, { error: 'Not Found' });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return sendJson(res, 500, { error });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[auggie-server] listening on http://${HOST}:${PORT}`);
  console.log(`[auggie-server] model: ${OPENROUTER_MODEL}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
