import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ProfileStore, canonical } from '../src/core/store.mjs';
import { copyPreferences } from '../src/core/preferences.mjs';
import { platformPaths, executableCandidates, desktopPlan, isolatedEnvironment, cliCommand, terminalScript, terminalPlan, shellQuote, powershellQuote, windowsDesktopCommands } from '../src/core/platform.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-profiles-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  const context = { root: path.join(root, 'app'), home,
    originalDesktop: path.join(home, 'Claude'), originalCode: path.join(home, '.claude') };
  const store = new ProfileStore(context); store.load();
  return { root, home, store, context };
}
test('first run preserves personal files and creates only its own registry', t => {
  const { store, context } = fixture(t);
  assert.equal(store.state.profiles.length, 2);
  assert.equal(fs.existsSync(context.originalDesktop), false);
  assert.equal(fs.existsSync(context.originalCode), false);
  assert.equal(fs.existsSync(store.state.profiles[1].codePath), false);
  store.prepare(store.original().id, 'code');
  assert.equal(fs.existsSync(context.originalCode), false);
});
test('save, reload and rename retain stable UUID paths', t => {
  const { store, context } = fixture(t);
  const before = store.state.profiles[1];
  store.save({ ...before, name: "Work / O'Brien" });
  const fresh = new ProfileStore(context); fresh.load();
  assert.equal(fresh.get(before.id).codePath, before.codePath);
  assert.equal(fresh.get(before.id).name, "Work / O'Brien");
});
test('duplicate names, paths, invalid colors and empty services are rejected', t => {
  const { store } = fixture(t); const p = store.state.profiles[1];
  for (const patch of [{ name: 'personal' }, { name: ' ' }, { color: 'pink' }, { desktop: false, code: false }, { name: 'a\nb' }, { name: 'a'.repeat(49) }]) {
    assert.throws(() => store.save({ ...p, ...patch }));
  }
  const doc = store.snapshot(); doc.profiles[1].codePath = doc.profiles[0].codePath;
  assert.throws(() => store.commit(doc), /already belongs/);
});
test('corrupt registry is never overwritten', t => {
  const { store, context } = fixture(t); fs.writeFileSync(store.file, 'broken');
  assert.throws(() => new ProfileStore(context).load(), /preserved/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'broken');
});
test('future registry versions are never overwritten', t => {
  const { store, context } = fixture(t); const doc = store.snapshot(); doc.schemaVersion = 99;
  fs.writeFileSync(store.file, JSON.stringify(doc));
  assert.throws(() => new ProfileStore(context).load(), /Unsupported/);
  assert.equal(JSON.parse(fs.readFileSync(store.file)).schemaVersion, 99);
});
test('remove and restore leave all account files on disk', t => {
  const { store } = fixture(t); const p = store.state.profiles[1]; store.prepare(p.id, 'desktop');
  const file = path.join(p.desktopPath, 'session'); fs.writeFileSync(file, 'preserve');
  store.remove(p.id); assert.equal(fs.readFileSync(file, 'utf8'), 'preserve');
  store.restore(p.id); assert.equal(store.get(p.id).desktopPath, p.desktopPath);
  assert.throws(() => store.remove(store.original().id), /cannot be removed/);
});
test('managed paths cannot be redirected by symlinks or junctions', t => {
  const { store, home } = fixture(t); const p = store.state.profiles[1];
  fs.mkdirSync(path.dirname(p.codePath), { recursive: true });
  fs.symlinkSync(home, p.codePath, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => store.prepare(p.id, 'code'), /redirected/);
});
test('macOS v1 registry migration preserves old paths and the old file', t => {
  const { store, context } = fixture(t);
  const old = { version: 1, profiles: store.state.profiles.map(p => ({ ...p, isOriginal: p.original, isImported: p.imported, desktopEnabled: p.desktop, codeEnabled: p.code })), settings: { claudeBinary: '', claudeApplication: '' } };
  fs.unlinkSync(store.file);
  const legacyPath = path.join(store.root, 'profiles.json'); const content = JSON.stringify(old);
  fs.writeFileSync(legacyPath, content);
  const migrated = new ProfileStore(context); migrated.load();
  assert.equal(migrated.state.profiles[1].desktopPath, old.profiles[1].desktopPath);
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), content);
});
test('importing and discovering profiles does not move or copy data', t => {
  const { store, home } = fixture(t); const folder = path.join(home, '.claude-client'); fs.mkdirSync(folder);
  const file = path.join(folder, 'marker'); fs.writeFileSync(file, 'original');
  assert.equal(store.discover().length, 1);
  const imported = store.import({ name: 'Client', codePath: folder, color: 'blue' });
  assert.equal(imported.codePath, canonical(folder));
  assert.equal(store.discover().length, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.throws(() => store.import({ name: 'Other', codePath: folder, color: 'sage' }), /already belongs/);
});
test('native v1 grapheme names and unrestricted labels survive migration and later changes', t => {
  const { store, context } = fixture(t);
  const id = 'A3A225AC-10BA-4231-A4DC-86AC686FE49A';
  const name = '👩🏽‍💻'.repeat(24), note = 'Long legacy label\n' + 'x'.repeat(250);
  const old = { version: 1, settings: { claudeBinary: '', claudeApplication: '' }, profiles: [
    { id: '00000000-0000-4000-8000-000000000001', name: 'Personale', note: 'Il tuo Claude di sempre',
      color: 'terracotta', isOriginal: true, isImported: false, desktopEnabled: true, codeEnabled: true,
      desktopPath: canonical(context.originalDesktop), codePath: canonical(context.originalCode), createdAt: 800000000 },
    { id, name, note, color: 'sage', isOriginal: false, isImported: false, desktopEnabled: true, codeEnabled: true,
      desktopPath: path.join(store.root, 'Profiles', id, 'Desktop'), codePath: path.join(store.root, 'Profiles', id, 'Code'), createdAt: 800000001 }
  ] };
  fs.unlinkSync(store.file);
  const legacyPath = path.join(store.root, 'profiles.json'), content = JSON.stringify(old);
  fs.writeFileSync(legacyPath, content);
  const migrated = new ProfileStore(context); migrated.load();
  assert.equal(migrated.get(id).name, name); assert.equal(migrated.get(id).note, note);
  migrated.save({ ...migrated.get(id), color: 'blue' });
  migrated.remove(id); migrated.restore(id);
  const reloaded = new ProfileStore(context); reloaded.load();
  assert.equal(reloaded.get(id).note, note);
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), content);
  assert.throws(() => reloaded.save({ ...reloaded.get(id), note: 'y'.repeat(201) }), /optional label/);
});
test('Windows process status distinguishes native CLI, Desktop and renderer processes', () => {
  const executable = 'C:\\Users\\Example\\AppData\\Local\\Claude\\Claude.exe';
  const command = `"${executable}" --user-data-dir="C:\\Profiles\\Work"`;
  const processes = [
    { ExecutablePath: 'C:\\Users\\Example\\.local\\bin\\claude.exe', CommandLine: 'claude.exe' },
    { ExecutablePath: executable.toUpperCase(), CommandLine: command },
    { ExecutablePath: executable, CommandLine: command + ' --type=renderer' },
    { ExecutablePath: null, CommandLine: 'claude.exe' }
  ];
  assert.deepEqual(windowsDesktopCommands(processes, executable), [command]);
  assert.deepEqual(windowsDesktopCommands(processes, null), []);
});
test('settings copy excludes account data, env, hooks and permissions', t => {
  const { store } = fixture(t); const source = store.original().codePath, target = store.state.profiles[1].codePath;
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'settings.json'), JSON.stringify({ model: 'test-model', env: { KEY: 'synthetic' }, hooks: {}, permissions: {}, language: 'it' }));
  for (const [name, text] of [['CLAUDE.md', 'instructions'], ['.credentials.json', 'secret-test'], ['history.jsonl', 'history-test']]) fs.writeFileSync(path.join(source, name), text);
  copyPreferences(source, target);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'settings.json'))), { model: 'test-model', language: 'it' });
  assert.equal(fs.existsSync(path.join(target, '.credentials.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'history.jsonl')), false);
});
test('preference copies skip existing files and symbolic directories', t => {
  const { store, home } = fixture(t); const source = store.original().codePath, target = store.state.profiles[1].codePath;
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(source, 'CLAUDE.md'), 'new'); fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'keep');
  fs.symlinkSync(home, path.join(source, 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = copyPreferences(source, target);
  assert.equal(report.skipped.length, 2); assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'keep');
  assert.throws(() => copyPreferences(source, source), /separate/);
});
test('canonical paths normalize aliases before duplicate checks', t => {
  const { home } = fixture(t);
  assert.equal(canonical(path.join(home, 'a', '..', 'b')), path.join(canonical(home), 'b'));
  assert.throws(() => canonical('../relative'));
  assert.throws(() => canonical(home + '\0bad'));
});

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`${platform}: original profile has no config override; separate profile does`, () => {
    const p = { original: false, desktopPath: '/profiles/work/Desktop', codePath: '/profiles/work/Code' };
    const env = { PATH: '/bin', ANTHROPIC_API_KEY: 'synthetic', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', CLAUDE_CONFIG_DIR: '/wrong' };
    const plan = desktopPlan(p, '/app/Claude', platform, env);
    assert.equal(plan.env.CLAUDE_CONFIG_DIR, p.codePath);
    assert.equal(plan.env.ANTHROPIC_API_KEY, undefined); assert.equal(plan.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.ok(plan.args.includes(`--user-data-dir=${p.desktopPath}`));
    const original = desktopPlan({ ...p, original: true }, '/app/Claude', platform, env);
    assert.equal(original.env.CLAUDE_CONFIG_DIR, undefined);
    assert.ok(!original.args.some(arg => arg.startsWith('--user-data-dir')));
    if (platform === 'darwin') assert.ok(plan.args.includes('--env'));
  });
  test(`${platform}: terminal command isolates work and quotes the executable`, () => {
    const p = { original: false, codePath: platform === 'win32' ? "C:\\Users\\O'Brien\\Code" : "/home/O'Brien/Code" };
    const command = cliCommand(p, '/my cli', platform);
    assert.ok(command.includes('CLAUDE_CONFIG_DIR')); assert.ok(command.includes('ANTHROPIC_API_KEY'));
    assert.ok(command.includes(platform === 'win32' ? powershellQuote('/my cli') : shellQuote('/my cli')));
    const script = terminalScript(p, '/my cli', '/project folder', platform);
    assert.ok(script.includes(platform === 'win32' ? 'Set-Location -LiteralPath' : 'cd --'));
  });
}
test('platform-specific home locations follow Windows APPDATA and Linux XDG', () => {
  assert.equal(platformPaths('darwin', '/Users/example', {}).root, '/Users/example/Library/Application Support/ClaudeProfiles');
  assert.equal(platformPaths('win32', 'C:\\Users\\Example', { APPDATA: 'D:\\Roaming' }).originalDesktop, 'D:\\Roaming\\Claude');
  assert.equal(platformPaths('linux', '/home/example', { XDG_CONFIG_HOME: '/data/config' }).root, '/data/config/ClaudeProfiles');
  assert.ok(executableCandidates('code', 'win32', 'C:\\Users\\Example', {}).some(p => p.endsWith('claude.exe')));
});
test('Linux terminal discovery uses argument arrays and fails explicitly when absent', () => {
  const script = '/path with spaces/profile.command';
  assert.deepEqual(terminalPlan(script, 'linux', name => name === 'gnome-terminal').args, ['--', '/bin/sh', script]);
  assert.throws(() => terminalPlan(script, 'linux', () => false), /No supported terminal/);
});
test('Windows terminal does not bypass execution policy or invoke cmd.exe', () => {
  const plan = terminalPlan('C:\\path\\script.ps1', 'win32', () => false, {}, "& 'claude.exe'");
  assert.ok(plan.executable.endsWith('powershell.exe'));
  assert.deepEqual(plan.args, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', "& 'claude.exe'"]);
  assert.ok(!JSON.stringify(plan).includes('Bypass'));
});
test('shell quoting prevents expansion and command injection on the host platform', () => {
  const payload = "O'Brien $(echo injected) `whoami` ; & | \"quoted\"";
  let result;
  if (process.platform === 'win32') {
    result = execFileSync('powershell.exe', ['-NoProfile', '-Command', `[Console]::Write(${powershellQuote(payload)})`], { encoding: 'utf8' });
  } else result = execFileSync('/bin/sh', ['-c', `printf '%s' ${shellQuote(payload)}`], { encoding: 'utf8' });
  assert.equal(result, payload);
});
test('case-insensitive environment keys cannot retain Windows auth overrides', () => {
  const env = isolatedEnvironment({ original: false, codePath: '/correct' }, { anthropic_api_key: 'synthetic', Claude_Config_Dir: '/wrong' });
  assert.equal(env.anthropic_api_key, undefined); assert.equal(env.Claude_Config_Dir, undefined); assert.equal(env.CLAUDE_CONFIG_DIR, '/correct');
});
