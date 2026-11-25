import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = path.join(root, 'src-tauri', 'gen', 'android');
const sourceRoot = path.join(root, 'android', 'ime');

if (!existsSync(androidRoot)) {
  console.log('[android-ime] No hay proyecto Android generado (src-tauri/gen/android); se omite.');
  process.exit(0);
}

const appMain = path.join(androidRoot, 'app', 'src', 'main');
const packageDir = path.join(appMain, 'java', 'com', 'englishrecord', 'app');
const xmlDir = path.join(appMain, 'res', 'xml');
const manifestPath = path.join(appMain, 'AndroidManifest.xml');
const proguardPath = path.join(androidRoot, 'app', 'proguard-rules.pro');
const androidIconsSource = path.join(root, 'src-tauri', 'icons', 'android');

await mkdir(packageDir, { recursive: true });
await mkdir(xmlDir, { recursive: true });

await copyChanged(
  path.join(sourceRoot, 'VoiceImeService.kt'),
  path.join(packageDir, 'VoiceImeService.kt'),
);
await copyChanged(path.join(sourceRoot, 'MainActivity.kt'), path.join(packageDir, 'MainActivity.kt'));
await copyChanged(path.join(sourceRoot, 'res', 'xml', 'method.xml'), path.join(xmlDir, 'method.xml'));

await syncAndroidIcons();
await patchManifest();
await patchProguard();

console.log('[android-ime] Teclado de voz preparado en el proyecto Android.');

async function syncAndroidIcons() {
  if (!existsSync(androidIconsSource)) return;
  const resTarget = path.join(appMain, 'res');
  const entries = await readdir(androidIconsSource, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fromDir = path.join(androidIconsSource, entry.name);
    const toDir = path.join(resTarget, entry.name);
    await mkdir(toDir, { recursive: true });
    const files = await readdir(fromDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      await copyChanged(path.join(fromDir, file.name), path.join(toDir, file.name));
    }
  }
}

async function copyChanged(from, to) {
  const next = await readFile(from);
  if (existsSync(to)) {
    const current = await readFile(to);
    if (current.equals(next)) return;
  }
  await copyFile(from, to);
  console.log('[android-ime]', path.relative(root, to));
}

async function patchManifest() {
  let manifest = await readFile(manifestPath, 'utf8');
  const before = manifest;

  for (const permission of [
    'android.permission.RECORD_AUDIO',
    'android.permission.MODIFY_AUDIO_SETTINGS',
  ]) {
    if (manifest.includes(`android:name="${permission}"`)) continue;
    const line = `    <uses-permission android:name="${permission}" />`;
    manifest = manifest.replace(/(<uses-permission [^>]*\/>)/, `$1\n${line}`);
  }

  if (!manifest.includes('android:name=".VoiceImeService"')) {
    const service = `        <service
            android:name=".VoiceImeService"
            android:exported="true"
            android:label="@string/app_name"
            android:permission="android.permission.BIND_INPUT_METHOD">
            <intent-filter>
                <action android:name="android.view.InputMethod" />
            </intent-filter>
            <meta-data
                android:name="android.view.im"
                android:resource="@xml/method" />
        </service>

`;
    manifest = manifest.replace(/(\n\s*<\/application>)/, `\n\n${service}$1`);
  }

  if (manifest !== before) {
    await writeFile(manifestPath, manifest);
    console.log('[android-ime] AndroidManifest.xml actualizado.');
  }
}

async function patchProguard() {
  let rules = existsSync(proguardPath) ? await readFile(proguardPath, 'utf8') : '';
  if (rules.includes('com.englishrecord.app.VoiceImeService')) return;
  rules += `
# English Record voice IME
-keep class com.englishrecord.app.VoiceImeService { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
`;
  await writeFile(proguardPath, rules);
  console.log('[android-ime] proguard-rules.pro actualizado.');
}
