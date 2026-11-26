import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const iconDirectory = fileURLToPath(new URL('../../assets/dock/', import.meta.url));
const applicationFolder = (root, id) => path.join(root, 'Dock Apps', id);

export async function macDesktopProcesses() {
  const { stdout } = await exec('/bin/ps', ['-ax', '-o', 'pid=', '-o', 'args='], { timeout: 6000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+) (.+?\.app)\/Contents\/MacOS\/Claude(?:\s+(.*))?$/.exec(line);
    if (!match || match[3]?.includes('--type=')) return [];
    return [{ pid: Number(match[1]), bundle: match[2], args: match[3] || '' }];
  });
}

export function macProcessForProfile(processes, profile, root, source) {
  return processes.find(item => {
    if (item.bundle.startsWith(applicationFolder(root, profile.id) + path.sep)) return true;
    if (item.bundle !== source && path.basename(item.bundle) !== 'Claude.app') return false;
    if (profile.original) return !item.args.includes('--user-data-dir');
    const escaped = profile.desktopPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s)--user-data-dir(?:=| )"?${escaped}(?=$|[\\s"])`).test(item.args);
  });
}

export async function activateMacDesktop(pid) {
  const script = 'function run(argv) { ObjC.import("AppKit"); const target = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0])); return target.activateWithOptions(0); }';
  const { stdout } = await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, String(pid)], { timeout: 7000 });
  return stdout.trim() === 'true';
}

export async function prepareMacDockApp(profile, source, root) {
  const location = applicationFolder(root, profile.id);
  const appName = profile.dockName || profile.name;
  const safeName = appName.replace(/[/:]/g, '∕').replace(/^\.+/, '·');
  const filename = (Buffer.byteLength(safeName.normalize('NFD')) <= 240 ? safeName : 'Claude Desktop') + '.app';
  const active = path.join(location, 'current');
  const target = path.join(active, filename);
  const icon = profile.dockIcon && profile.dockIcon !== 'default' ? path.join(iconDirectory, `${profile.dockIcon}.icns`) : '';
  const { stderr } = await exec('/usr/bin/codesign', ['-d', '--verbose=4', source], { timeout: 10000 });
  const sourceHash = /^CDHash=([a-f0-9]+)$/m.exec(stderr)?.[1];
  if (!sourceHash) throw new Error('Could not read the installed Claude Desktop signature.');
  const key = createHash('sha256').update(JSON.stringify([source, sourceHash, appName, profile.dockIcon,
    icon ? (await fs.readFile(icon)).toString('base64') : ''])).digest('hex');
  const cached = await fs.readFile(path.join(active, 'signature'), 'utf8').catch(() => '');
  if (cached === key) {
    try {
      await fs.access(path.join(target, 'Contents', 'MacOS', 'Claude'));
      const { stderr: details } = await exec('/usr/bin/codesign', ['-d', '--verbose=4', target], { timeout: 10000 });
      if (details.includes('Signature=adhoc')) return target;
    } catch { /* Recreate a missing or replaced copy. */ }
  }

  await fs.mkdir(location, { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(location, '.prepare-'));
  const bundle = path.join(staging, filename);
  try {
    // Keep the vendor's nested signatures when intact. Some installed copies
    // already have local modifications and require signing nested code again.
    const nestedSignaturesValid = await exec('/usr/bin/codesign',
      ['--verify', '--deep', '--strict', source], { timeout: 60000 }).then(() => true, () => false);
    await exec('/usr/bin/ditto', [source, bundle], { timeout: 180000 });
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    const set = (key, value) => exec('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
    await set('CFBundleDisplayName', appName);
    await set('CFBundleName', appName);
    if (icon) {
      await fs.copyFile(icon, path.join(bundle, 'Contents', 'Resources', 'ClaudeProfilesDock.icns'));
      await set('CFBundleIconFile', 'ClaudeProfilesDock.icns');
      const { stdout } = await exec('/usr/bin/plutil', ['-type', 'CFBundleIconName', plist], { timeout: 5000 }).catch(() => ({}));
      if (stdout) await exec('/usr/bin/plutil', ['-remove', 'CFBundleIconName', plist]);
    }
    await exec('/usr/bin/codesign', ['--force', ...(nestedSignaturesValid ? [] : ['--deep']), '--sign', '-',
      '--preserve-metadata=identifier,entitlements', bundle], { timeout: 60000 });
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 60000 });
    await fs.writeFile(path.join(staging, 'signature'), key, { mode: 0o600 });
    await fs.rm(active, { recursive: true, force: true });
    await fs.rename(staging, active);
    return target;
  } catch (error) {
    throw new Error(`Could not prepare the custom Dock app. ${error.stderr?.trim().split('\n').at(-1) || error.message}`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
