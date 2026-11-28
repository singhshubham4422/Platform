#!/usr/bin/env node
// Downloads portable Python, Java (JDK slimmed with jlink) and C/C++ (Zig's bundled clang)
// for the machine running this script, verifies their SHA-256, and lays them out in
// src-tauri/runtimes/ with manifest.json. `tauri build` ships that folder in the installer, so
// students run code without installing any compiler. Run it on each target OS (CI does this).
//
//   node scripts/fetch-runtimes.mjs [--clean]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const PYTHON = { version: '3.12.7', release: '20241016' };
const ZIG = { version: '0.13.0' };
const JAVA = { feature: 21 };
// Modules a student program needs: core library, the compiler (javac) and common extras.
const JAVA_MODULES = [
  'java.base',
  'java.logging',
  'java.xml',
  'java.sql',
  'jdk.compiler',
  'jdk.zipfs',
  'jdk.unsupported',
];

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const outDir = path.join(appDir, 'src-tauri', 'runtimes');
const cacheDir = path.resolve(appDir, '..', '..', '.local', 'runtime-cache');

const hostOs = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
const hostArch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
if (!hostOs || !hostArch) throw new Error(`Unsupported host ${process.platform}/${process.arch}`);
const win = hostOs === 'windows';
const exe = win ? '.exe' : '';
const sep = win ? '\\' : '/';
const tarBin = win
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar';

const log = (msg) => console.log(`[runtimes] ${msg}`);

async function download(url, file, expectedSha256) {
  if (existsSync(file) && (await sha256(file)) === expectedSha256) {
    log(`cached ${path.basename(file)}`);
    return file;
  }
  log(`downloading ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'platform-runtime-fetch' },
  });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  const actual = await sha256(file);
  if (actual !== expectedSha256)
    throw new Error(`SHA-256 mismatch for ${url}: ${actual} != ${expectedSha256}`);
  return file;
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'platform-runtime-fetch' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function extract(archive, dest) {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  execFileSync(tarBin, ['-xf', archive, '-C', dest], { stdio: 'inherit' });
}

async function onlyChild(dir) {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory());
  if (entries.length !== 1) throw new Error(`Expected one folder in ${dir}`);
  return path.join(dir, entries[0].name);
}

async function fetchPython(work) {
  const triple = {
    'windows-x86_64': 'x86_64-pc-windows-msvc',
    'macos-aarch64': 'aarch64-apple-darwin',
    'macos-x86_64': 'x86_64-apple-darwin',
    'linux-x86_64': 'x86_64-unknown-linux-gnu',
    'linux-aarch64': 'aarch64-unknown-linux-gnu',
  }[`${hostOs}-${hostArch}`];
  const name = `cpython-${PYTHON.version}+${PYTHON.release}-${triple}-install_only_stripped.tar.gz`;
  const base = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON.release}`;
  const sums = await getText(`${base}/SHA256SUMS`);
  const line = sums.split('\n').find((l) => l.trim().endsWith(name));
  if (!line) throw new Error(`No checksum for ${name}`);
  const archive = await download(
    `${base}/${encodeURIComponent(name)}`,
    path.join(cacheDir, name),
    line.split(/\s+/)[0],
  );
  const tmp = path.join(work, 'python');
  await extract(archive, tmp);
  await cp(path.join(tmp, 'python'), path.join(outDir, 'python'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  return {
    language: 'PYTHON',
    version: PYTHON.version,
    dir: 'python',
    sourceFile: 'main.py',
    compile: null,
    run: [win ? `{runtime}${sep}python.exe` : `{runtime}/bin/python3`, '-I', '-X', 'utf8', '{src}'],
  };
}

async function fetchZig(work) {
  const index = JSON.parse(await getText('https://ziglang.org/download/index.json'));
  const entry = index[ZIG.version]?.[`${hostArch}-${hostOs}`];
  if (!entry) throw new Error(`No Zig ${ZIG.version} build for ${hostArch}-${hostOs}`);
  const archive = await download(
    entry.tarball,
    path.join(cacheDir, path.basename(entry.tarball)),
    entry.shasum,
  );
  const tmp = path.join(work, 'zig');
  await extract(archive, tmp);
  const root = await onlyChild(tmp);
  await rm(path.join(root, 'doc'), { recursive: true, force: true });
  await cp(root, path.join(outDir, 'zig'), { recursive: true, verbatimSymlinks: true });
  const zig = `{runtime}${sep}zig${exe}`;
  const env = { ZIG_GLOBAL_CACHE_DIR: `{cache}${sep}zig`, ZIG_LOCAL_CACHE_DIR: `{cache}${sep}zig` };
  const linkMath = hostOs === 'linux' ? ['-lm'] : [];
  return [
    {
      language: 'C',
      version: ZIG.version,
      dir: 'zig',
      sourceFile: 'main.c',
      compile: [zig, 'cc', '-std=c11', '-O2', '-o', '{exe}', '{src}', ...linkMath],
      run: ['{exe}'],
      env,
    },
    {
      language: 'CPP',
      version: ZIG.version,
      dir: 'zig',
      sourceFile: 'main.cpp',
      compile: [zig, 'c++', '-std=c++17', '-O2', '-o', '{exe}', '{src}', ...linkMath],
      run: ['{exe}'],
      env,
    },
  ];
}

async function fetchJava(work) {
  const apiOs = { windows: 'windows', macos: 'mac', linux: 'linux' }[hostOs];
  const apiArch = { x86_64: 'x64', aarch64: 'aarch64' }[hostArch];
  const url = `https://api.adoptium.net/v3/assets/feature_releases/${JAVA.feature}/ga?os=${apiOs}&architecture=${apiArch}&image_type=jdk&jvm_impl=hotspot&vendor=eclipse&page_size=1&sort_order=DESC`;
  const [release] = JSON.parse(await getText(url));
  const pkg = release?.binaries?.[0]?.package;
  if (!pkg) throw new Error(`No Temurin ${JAVA.feature} JDK for ${apiOs}/${apiArch}`);
  const { major, minor, security } = release.version_data;
  const version = `${major}.${minor}.${security}`;
  const archive = await download(pkg.link, path.join(cacheDir, pkg.name), pkg.checksum);
  const tmp = path.join(work, 'jdk');
  await extract(archive, tmp);
  let home = await onlyChild(tmp);
  if (existsSync(path.join(home, 'Contents', 'Home'))) home = path.join(home, 'Contents', 'Home');
  const jlink = path.join(home, 'bin', `jlink${exe}`);
  const target = path.join(outDir, 'java');
  await rm(target, { recursive: true, force: true });
  log('building slim Java runtime with jlink');
  execFileSync(
    jlink,
    [
      '--add-modules',
      JAVA_MODULES.join(','),
      '--strip-debug',
      '--no-man-pages',
      '--no-header-files',
      '--output',
      target,
    ],
    { stdio: 'inherit' },
  );
  // jlink already copies the legal notices of every module it includes into `legal/`.
  return {
    language: 'JAVA',
    version,
    dir: 'java',
    sourceFile: 'Main.java',
    compile: [
      `{runtime}${sep}bin${sep}javac${exe}`,
      '-J-Xmx512m',
      '-J-XX:+UseSerialGC',
      '-J-XX:TieredStopAtLevel=1',
      '-encoding',
      'UTF-8',
      '-d',
      '{out}',
      '{src}',
    ],
    // Small fixed JVM reservations keep the process under the runner's address-space limit.
    run: [
      `{runtime}${sep}bin${sep}java${exe}`,
      '-Xmx{memMb}m',
      '-Xss16m',
      '-XX:+UseSerialGC',
      '-XX:TieredStopAtLevel=1',
      '-XX:ReservedCodeCacheSize=64m',
      '-XX:CompressedClassSpaceSize=64m',
      '-XX:MaxMetaspaceSize=128m',
      '-Dfile.encoding=UTF-8',
      '-cp',
      '{out}',
      '{main}',
    ],
  };
}

async function sizeOf(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await stat(path.join(e.parentPath ?? e.path, e.name))).size;
  }
  return total;
}

/** Tauri refuses to bundle a symlink whose target is missing, so remove any such link. */
async function dropDanglingLinks(dir) {
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    const file = path.join(e.parentPath ?? e.path, e.name);
    if (!(await lstat(file)).isSymbolicLink()) continue;
    try {
      await stat(file);
    } catch {
      log(`removing broken link ${path.relative(outDir, file)}`);
      await rm(file, { force: true });
    }
  }
}

async function main() {
  if (process.argv.includes('--clean')) await rm(cacheDir, { recursive: true, force: true });
  for (const d of ['python', 'zig', 'java'])
    await rm(path.join(outDir, d), { recursive: true, force: true });
  await rm(path.join(outDir, 'manifest.json'), { force: true });
  const work = path.join(os.tmpdir(), `platform-runtimes-${process.pid}`);
  await mkdir(work, { recursive: true });
  try {
    const runtimes = [await fetchPython(work), ...(await fetchZig(work)), await fetchJava(work)];
    for (const d of ['python', 'zig', 'java']) await dropDanglingLinks(path.join(outDir, d));
    const manifest = {
      schemaVersion: 1,
      os: hostOs,
      arch: hostArch,
      generatedAt: new Date().toISOString(),
      runtimes,
    };
    await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const d of ['python', 'zig', 'java'])
      log(`${d}: ${((await sizeOf(path.join(outDir, d))) / 1048576).toFixed(0)} MB`);
    log(`wrote ${path.join(outDir, 'manifest.json')} for ${hostOs}-${hostArch}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
