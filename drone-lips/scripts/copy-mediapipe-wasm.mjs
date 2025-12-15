import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const destDir = path.join(repoRoot, 'public', 'mediapipe', 'wasm');

async function main() {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    await fs.copyFile(from, to);
    copied += 1;
  }

  console.log(
    `[copy-mediapipe-wasm] Copied ${copied} file(s) to ${path.relative(repoRoot, destDir)}`,
  );
}

main().catch((err) => {
  console.error('[copy-mediapipe-wasm] Failed:', err);
  process.exitCode = 1;
});
