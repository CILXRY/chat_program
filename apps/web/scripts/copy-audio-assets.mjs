// Copies the prebuilt AudioWorklet / Worker / WASM artefacts that back the
// selectable noise-suppression models into `public/audio`.
//
// The files are build artefacts of `@cc-livekit/audio-pipeline-plugin` and are
// intentionally not committed. `predev`, `prebuild` and `postinstall` all run
// this script so a fresh checkout (and the Docker image) always has them.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const destination = join(packageRoot, 'public', 'audio');

const files = [
  'AudioPipelineWorklet.js',
  'AudioPipelineWorker.js',
  'rnnoise.wasm',
  'deepfilter.wasm',
];

let dist;
try {
  dist = dirname(require.resolve('@cc-livekit/audio-pipeline-plugin'));
} catch {
  console.warn('[audio-assets] audio pipeline package is not installed yet; skipping');
  process.exit(0);
}

await mkdir(destination, { recursive: true });
for (const file of files) {
  await copyFile(join(dist, file), join(destination, file));
}

console.log(`[audio-assets] copied ${files.length} files to ${destination}`);
