import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const AUTH_VARIABLES = Object.freeze([
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_PROFILE',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_USER_DATA_DIR',
]);

export function platformPaths(platform = process.platform, home = os.homedir(), env = process.env) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const appData = platform === 'darwin' ? p.join(home, 'Library', 'Application Support')
    : platform === 'win32' ? (env.APPDATA || p.join(home, 'AppData', 'Roaming'))
      : (env.XDG_CONFIG_HOME || p.join(home, '.config'));
  return { platform, home, root: p.join(appData, 'ClaudeProfiles'),
    originalDesktop: p.join(appData, 'Claude'), originalCode: p.join(home, '.claude') };
}

export function executableCandidates(kind, platform = process.platform, home = os.homedir(), env = process.env) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (kind === 'desktop') {
    if (platform === 'darwin') return ['/Applications/Claude.app', p.join(home, 'Applications', 'Claude.app')];
    if (platform === 'win32') {
      const local = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
      return [p.join(local, 'AnthropicClaude', 'claude.exe'), p.join(local, 'Programs', 'Claude', 'Claude.exe'),
        p.join(local, 'Claude', 'Claude.exe'), p.join(env.ProgramFiles || 'C:\\Program Files', 'Claude', 'Claude.exe')];
    }
    return ['/usr/bin/claude-desktop', '/usr/local/bin/claude-desktop', '/opt/Claude/claude-desktop', '/opt/claude-desktop/claude-desktop'];
  }
  const binary = platform === 'win32' ? 'claude.exe' : 'claude';
  const paths = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  return [p.join(home, '.local', 'bin', binary),
    ...(platform === 'win32' ? [] : ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', p.join(home, '.npm-global', 'bin', 'claude')]),
    ...paths.map(folder => p.join(folder, binary))];
}

export function findExecutable(kind, configured, platform = process.platform) {
  const candidates = configured ? [configured] : executableCandidates(kind, platform);
  return candidates.find(file => {
    try {
      const target = platform === 'darwin' && kind === 'desktop' ? path.join(file, 'Contents', 'MacOS', 'Claude') : file;
      return fs.statSync(target).isFile() && (fs.accessSync(target, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK), true);
    } catch { return false; }
  }) || null;
}

export function isolatedEnvironment(profile, env = process.env) {
  const result = { ...env };
  // Electron's own process flags must never leak into the app being launched.
  for (const key of Object.keys(result)) {
    const name = key.toUpperCase();
    if (name === 'CLAUDE_CONFIG_DIR' || name.startsWith('ELECTRON_') || name === 'NODE_OPTIONS' ||
        (!profile.original && AUTH_VARIABLES.includes(name))) delete result[key];
  }
  if (!profile.original) result.CLAUDE_CONFIG_DIR = profile.codePath;
  return result;
}

export function windowsDesktopCommands(processes, executable) {
  if (!executable) return [];
  const key = value => path.win32.normalize(value).toLowerCase();
  return processes.filter(item => typeof item?.ExecutablePath === 'string' &&
    key(item.ExecutablePath) === key(executable) && typeof item.CommandLine === 'string' &&
    !item.CommandLine.includes('--type=')).map(item => item.CommandLine);
}

export function desktopPlan(profile, executable, platform = process.platform, env = process.env) {
  const args = profile.original ? [] : [`--user-data-dir=${profile.desktopPath}`];
  if (platform === 'darwin') {
    return { executable: '/usr/bin/open', args: [...(profile.original ? [] : ['-n', '--env', `CLAUDE_CONFIG_DIR=${profile.codePath}`]), '-a', executable, '--args', ...args], env: isolatedEnvironment(profile, env) };
  }
  return { executable, args, env: isolatedEnvironment(profile, env) };
}

export const shellQuote = value => `'${String(value).replaceAll("'", `'"'"'`)}'`;
export const powershellQuote = value => `'${String(value).replaceAll("'", "''")}'`;

export function cliCommand(profile, binary, platform = process.platform) {
  const cleared = profile.original ? ['CLAUDE_CONFIG_DIR'] : [...AUTH_VARIABLES, 'CLAUDE_CONFIG_DIR'];
  if (platform === 'win32') {
    const clear = cleared.map(key => `Remove-Item -LiteralPath 'Env:${key}' -ErrorAction SilentlyContinue`).join('; ');
    const config = profile.original ? '' : `; $env:CLAUDE_CONFIG_DIR = ${powershellQuote(profile.codePath)}`;
    return `${clear}${config}; & ${powershellQuote(binary)}`;
  }
  return `/usr/bin/env ${cleared.map(key => `-u ${key}`).join(' ')}${profile.original ? '' : ` CLAUDE_CONFIG_DIR=${shellQuote(profile.codePath)}`} ${shellQuote(binary)}`;
}

export function terminalScript(profile, binary, directory, platform = process.platform) {
  if (platform === 'win32') {
    return `$ErrorActionPreference = 'Stop'\r\nSet-Location -LiteralPath ${powershellQuote(directory)}\r\n${cliCommand(profile, binary, platform)}\r\n`;
  }
  return `#!/bin/sh\ncd -- ${shellQuote(directory)} || exit 1\nexec ${platform === 'darwin' ? '/bin/zsh' : '/bin/bash'} -lic ${shellQuote(cliCommand(profile, binary, platform))}\n`;
}

export function terminalPlan(script, platform = process.platform, available = () => false, env = process.env, windowsCommand = '') {
  if (platform === 'darwin') return { executable: '/usr/bin/open', args: ['-a', 'Terminal', script] };
  if (platform === 'win32') {
    const executable = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!windowsCommand) throw new Error('A Windows terminal command is required.');
    // Interactive commands do not require enabling .ps1 files. No Bypass / policy changes.
    return { executable, args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', windowsCommand] };
  }
  for (const [executable, args] of [
    ['x-terminal-emulator', ['-e', '/bin/sh', script]],
    ['gnome-terminal', ['--', '/bin/sh', script]],
    ['konsole', ['-e', '/bin/sh', script]],
    ['xfce4-terminal', ['--execute', '/bin/sh', script]],
    ['kitty', ['/bin/sh', script]], ['alacritty', ['-e', '/bin/sh', script]], ['xterm', ['-e', '/bin/sh', script]],
  ]) if (available(executable)) return { executable, args };
  throw new Error('No supported terminal found. Install a terminal or use Copy command.');
}
