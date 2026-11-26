import fs from 'node:fs/promises';
import { createWriteStream, constants, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repository = 'MarcoBallotti/claude-profiles';
const tag = 'main-builds';
const bundleId = 'io.github.marcoballotti.claudeprofiles';
const maxArchiveSize = 512 * 1024 * 1024;
const parts = version => version.split('.').map(Number);
const compare = (a, b) => a.reduce((order, value, i) => order || value - b[i], 0);

export function selectMacUpdate(assets, arch, version, build) {
  const currentVersion = parts(version);
  const currentBuild = parts(build || '0.0');
  return assets.flatMap(asset => {
    const match = /^Claude-Profiles-(\d+\.\d+\.\d+)-main-(\d+\.\d+)-mac-(arm64|x64)\.zip$/.exec(asset.name);
    const digest = /^sha256:([a-f0-9]{64})$/.exec(asset.digest);
    if (!match || match[3] !== arch || !digest || asset.state !== 'uploaded' ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxArchiveSize ||
        compare(parts(match[1]), currentVersion) < 0 || compare(parts(match[2]), currentBuild) <= 0) return [];
    return [{ name: asset.name, version: match[1], build: match[2], digest: digest[1], size: asset.size }];
  }).sort((a, b) => compare(parts(b.build), parts(a.build)))[0] || null;
}

export async function checkMacUpdate(arch, version, build) {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Claude-Profiles' },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('GitHub could not check for updates.');
  return selectMacUpdate((await response.json()).assets, arch, version, build);
}

async function download(update, archive) {
  const response = await fetch(`https://github.com/${repository}/releases/download/${tag}/${update.name}`, {
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok || !response.body) throw new Error('GitHub could not download the update.');
  const hash = createHash('sha256');
  let received = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > update.size) return callback(new Error('The update exceeded its expected size.'));
      hash.update(chunk);
      callback(null, chunk);
    },
  }), createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
  if (received !== update.size || hash.digest('hex') !== update.digest) throw new Error('The downloaded update failed its checksum.');
}

export async function installMacUpdate(update, bundle, executable, restart) {
  const parent = path.dirname(bundle);
  try { await fs.access(parent, constants.W_OK); }
  catch { throw new Error('Move Claude Profiles to a writable Applications folder and reopen it to install updates.'); }
  const staging = await fs.mkdtemp(path.join(parent, '.claude-profiles-update-'));
  const backup = path.join(staging, 'Previous.app');
  let preserveBackup = false;
  try {
    const archive = path.join(staging, 'update.zip');
    const unpacked = path.join(staging, 'unpacked');
    const next = path.join(unpacked, 'Claude Profiles.app');
    await download(update, archive);
    await exec('/usr/bin/ditto', ['-x', '-k', archive, unpacked], { timeout: 120000 });
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=identifier "${bundleId}"`, next], { timeout: 30000 });
    const plist = path.join(next, 'Contents', 'Info.plist');
    const { stdout } = await exec('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist]);
    const { stdout: version } = await exec('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]);
    if (stdout.trim() !== `1.${update.build}` || version.trim() !== update.version) {
      throw new Error('The update bundle does not match the published build.');
    }
    await fs.access(path.join(next, path.relative(bundle, executable)), constants.X_OK);
    renameSync(bundle, backup);
    let replaced = false;
    try {
      renameSync(next, bundle);
      replaced = true;
      restart();
    } catch (error) {
      try {
        if (replaced) renameSync(bundle, next);
        renameSync(backup, bundle);
      } catch {
        preserveBackup = true;
        throw new Error(`Restore the previous application from ${backup}.`);
      }
      throw error;
    }
  } finally {
    if (!preserveBackup) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
