import fs from 'node:fs';
import path from 'node:path';
import { pathKey } from './store.mjs';

export const INSTRUCTIONS = ['CLAUDE.md', 'skills', 'agents', 'commands', 'rules', 'output-styles'];
export const PREFERENCES = ['model', 'effortLevel', 'language', 'alwaysThinkingEnabled', 'showTurnDuration',
  'spinnerTipsEnabled', 'spinnerVerbs', 'terminalProgressBarEnabled', 'prefersReducedMotion'];

export function copyPreferences(source, target, { instructions = true, preferences = true } = {}) {
  const a = pathKey(source), b = pathKey(target);
  if (a === b || b.startsWith(a + path.sep) || a.startsWith(b + path.sep)) throw new Error('Source and destination must be separate profile folders.');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('The destination cannot be a symbolic link.');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const report = { copied: [], skipped: [] };
  const copy = (from, to, label) => {
    const info = fs.lstatSync(from);
    if (info.isSymbolicLink()) { report.skipped.push(`${label} (symlink)`); return; }
    try {
      if (info.isDirectory()) {
        fs.mkdirSync(to, { mode: 0o700 });
        for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry), `${label}/${entry}`);
      } else if (info.isFile()) {
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); report.copied.push(label);
      }
    } catch (error) {
      if (error.code === 'EEXIST') report.skipped.push(`${label} (already exists)`); else throw error;
    }
  };
  if (instructions) for (const name of INSTRUCTIONS) {
    try { fs.lstatSync(path.join(source, name)); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    copy(path.join(source, name), path.join(target, name), name);
  }
  const input = path.join(source, 'settings.json');
  if (preferences && fs.existsSync(input)) {
    if (fs.lstatSync(input).isSymbolicLink()) report.skipped.push('settings.json (symlink)');
    else {
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(input, 'utf8')); }
      catch { throw new Error('The source settings.json is invalid. Instructions already copied were kept; fix that file and retry.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The source settings.json must contain a JSON object.');
      const filtered = Object.fromEntries(PREFERENCES.filter(key => Object.hasOwn(parsed, key)).map(key => [key, parsed[key]]));
      if (Object.keys(filtered).length) {
        try {
          fs.writeFileSync(path.join(target, 'settings.json'), JSON.stringify(filtered, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          report.copied.push('settings.json (selected preferences)');
        } catch (error) { if (error.code === 'EEXIST') report.skipped.push('settings.json (already exists)'); else throw error; }
      }
    }
  }
  return report;
}
