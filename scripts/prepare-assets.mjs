import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const copies = [
  {
    from: path.join(root, 'models', 'ggml-base.en-q5_1.bin'),
    to: path.join(root, 'public', 'models', 'ggml-base.en-q5_1.bin'),
  },
  {
    from: path.join(root, 'models', 'silero_vad.onnx'),
    to: path.join(root, 'public', 'models', 'silero_vad.onnx'),
  },
  {
    from: path.join(root, 'node_modules', '@fugood', 'node-whisper-wasm', 'wasm', 'whisper-node.js'),
    to: path.join(root, 'public', 'whisper', 'whisper-node.js'),
  },
  {
    from: path.join(root, 'node_modules', '@fugood', 'node-whisper-wasm', 'wasm', 'whisper-node.wasm'),
    to: path.join(root, 'public', 'whisper', 'whisper-node.wasm'),
  },
  {
    from: path.join(root, 'node_modules', '@fugood', 'node-whisper-wasm', 'wasm', 'whisper-node.threads.js'),
    to: path.join(root, 'public', 'whisper', 'whisper-node.threads.js'),
  },
  {
    from: path.join(root, 'node_modules', '@fugood', 'node-whisper-wasm', 'wasm', 'whisper-node.threads.wasm'),
    to: path.join(root, 'public', 'whisper', 'whisper-node.threads.wasm'),
  },
  {
    from: path.join(root, 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.wasm'),
    to: path.join(root, 'public', 'ort', 'ort-wasm-simd-threaded.wasm'),
  },
  {
    from: path.join(root, 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.mjs'),
    to: path.join(root, 'public', 'ort', 'ort-wasm-simd-threaded.mjs'),
  },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.error(`[assets] Falta ${path.relative(root, from)}. Ejecuta "npm install" y asegúrate de que models/ esté completo.`);
    process.exitCode = 1;
    continue;
  }

  await mkdir(path.dirname(to), { recursive: true });

  const sameFile = existsSync(to) ? await stat(to) : null;
  const source = await stat(from);
  if (!sameFile || sameFile.size !== source.size) {
    await copyFile(from, to);
    console.log(`[assets] ${path.relative(root, to)} (${(source.size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

if (!process.exitCode) {
  console.log('[assets] Modelos y runtimes listos.');
}
