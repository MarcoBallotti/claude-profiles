import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { desktopPlan, terminalPlan, terminalScript, findExecutable, isolatedEnvironment, windowsDesktopCommands } from './core/platform.mjs';

const exec = promisify(execFile);
const powershell = () => path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function start(plan, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.executable, plan.args, { detached: true, stdio: 'ignore', shell: false,
      env: plan.env || process.env, windowsHide: false, ...options });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child.pid); });
  });
}

export class Launcher {
  constructor(store, { preview = false } = {}) { this.store = store; this.preview = preview; this.storeDesktop = null; }
  async detect() {
    const settings = this.store.state.settings;
    let desktop = findExecutable('desktop', settings.desktopExecutable);
    if (!desktop && !settings.desktopExecutable && process.platform === 'win32') {
      // Resolve Microsoft Store package manifests instead of guessing versioned WindowsApps paths.
      if (!this.storeDesktop) {
        const query = `@(Get-AppxPackage | Where-Object { $_.Name -match 'Claude' } | ForEach-Object { $p=$_; (Get-AppxPackageManifest $p).Package.Applications.Application | ForEach-Object { if ($_.Executable) { Join-Path $p.InstallLocation $_.Executable } } }) | ConvertTo-Json -Compress`;
        try {
          const { stdout } = await exec(powershell(), ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: 10000, windowsHide: true });
          const parsed = JSON.parse(stdout || '[]');
          this.storeDesktop = (Array.isArray(parsed) ? parsed : [parsed]).find(file => /claude\.exe$/i.test(file) && fs.existsSync(file)) || null;
        } catch { /* An explicit path remains available in Settings. */ }
      }
      desktop = this.storeDesktop;
    }
    return { desktop, code: findExecutable('code', settings.cliExecutable) };
  }
  async desktop(id) {
    if (this.preview) throw new Error('Launching Claude is disabled in preview mode.');
    const profile = this.store.get(id);
    if (!profile.desktop) throw new Error('Desktop is disabled for this profile.');
    const executable = (await this.detect()).desktop;
    if (!executable) throw new Error('Claude Desktop was not found. Select your installed application in Settings.');
    this.store.prepare(id, 'desktop'); this.store.prepare(id, 'code');
    return start(desktopPlan(profile, executable));
  }
  async terminal(id, directory = this.store.home) {
    if (this.preview) throw new Error('Launching Claude is disabled in preview mode.');
    const profile = this.store.get(id);
    if (!profile.code) throw new Error('Claude Code is disabled for this profile.');
    const executable = (await this.detect()).code;
    if (!executable) throw new Error('Claude Code was not found. Install the native CLI or select its executable in Settings.');
    this.store.prepare(id, 'code');
    const folder = path.join(this.store.root, 'Launchers');
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const script = path.join(folder, `${id}${process.platform === 'win32' ? '.ps1' : '.command'}`);
    fs.writeFileSync(script, terminalScript(profile, executable, directory), { mode: 0o700 });
    const available = name => (process.env.PATH || '').split(path.delimiter).some(dir => {
      try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { return false; }
    });
    const plan = terminalPlan(script, process.platform, available, process.env, terminalScript(profile, executable, directory));
    plan.env = isolatedEnvironment(profile);
    return start(plan, { cwd: directory });
  }
  async status() {
    try {
      let commands;
      if (process.platform === 'win32') {
        const executable = (await this.detect()).desktop;
        const query = `@(Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'" | Select-Object ExecutablePath, CommandLine) | ConvertTo-Json -Compress`;
        const { stdout } = await exec(powershell(), ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: 6000, windowsHide: true });
        const parsed = JSON.parse(stdout || '[]'); commands = windowsDesktopCommands(Array.isArray(parsed) ? parsed : [parsed], executable);
      } else {
        const { stdout } = await exec('/bin/ps', ['-ax', '-o', 'args='], { timeout: 6000, maxBuffer: 4 * 1024 * 1024 });
        commands = stdout.split('\n').filter(line => !line.includes('--type=') &&
          (process.platform === 'darwin' ? /\/Claude\.app\/Contents\/MacOS\/Claude(?:\s|$)/.test(line)
            : /(?:^|\/)claude-desktop(?:\s|$)/.test(line)));
      }
      const equal = process.platform === 'win32' ? value => value.toLowerCase().replaceAll('\\', '/') : value => value;
      const running = this.store.state.profiles.filter(profile => commands.some(command => {
        if (profile.original) return !command.includes('--user-data-dir');
        return [`--user-data-dir=${profile.desktopPath}`, `--user-data-dir ${profile.desktopPath}`, `--user-data-dir="${profile.desktopPath}"`]
          .some(marker => {
            const hay = equal(command), needle = equal(marker), at = hay.indexOf(needle);
            return at !== -1 && (at + needle.length === hay.length || /[\s"]/.test(hay[at + needle.length]));
          });
      })).map(p => p.id);
      return { running, statusAvailable: true };
    } catch { return { running: [], statusAvailable: false }; }
  }
}
