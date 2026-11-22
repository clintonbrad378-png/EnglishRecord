import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src-tauri', 'resources', 'models');
await mkdir(out, { recursive: true });
const files = ['ggml-base.en-q5_1.bin', 'silero_vad.onnx'];
for (const f of files) {
  const from = path.join(root, 'models', f);
  const to = path.join(out, f);
  if (!existsSync(from)) { console.error('[tauri-assets] falta', from); process.exit(1); }
  await copyFile(from, to);
  console.log('[tauri-assets]', f);
}
