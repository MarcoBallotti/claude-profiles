import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { platformPaths } from './platform.mjs';

export const COLORS = Object.freeze(['terracotta', 'sage', 'blue', 'plum', 'amber', 'graphite']);
const ORIGINAL_ID = '00000000-0000-4000-8000-000000000001';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const control = /[\u0000-\u001f\u007f]/;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const fail = message => { throw new Error(message); };

export function canonical(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || control.test(input)) fail('Choose a valid absolute folder path.');
  let ancestor = path.resolve(input);
  const tail = [];
  while (true) {
    try { return path.join(fs.realpathSync.native(ancestor), ...tail.reverse()); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      tail.push(path.basename(ancestor)); ancestor = parent;
    }
  }
}
export function pathKey(input) {
  const value = canonical(input);
  return process.platform === 'win32' ? value.toLowerCase() : value;
}
function privateFolder(folder) { fs.mkdirSync(folder, { recursive: true, mode: 0o700 }); }
function privateJSON(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

export class ProfileStore {
  constructor(options = {}) {
    this.context = { ...platformPaths(), ...options };
    this.root = canonical(this.context.root);
    this.home = canonical(this.context.home);
    this.file = path.join(this.root, 'profiles-v2.json');
    this.state = null;
  }
  original() {
    return { id: ORIGINAL_ID, name: 'Personal', note: 'Your existing Claude setup', color: 'terracotta',
      original: true, imported: false, desktop: true, code: true,
      desktopPath: canonical(this.context.originalDesktop), codePath: canonical(this.context.originalCode) };
  }
  managed(input = {}) {
    const id = randomUUID();
    return { id, name: input.name ?? 'Work', note: input.note ?? '', color: input.color ?? 'sage',
      desktop: input.desktop !== false, code: input.code !== false, original: false, imported: false,
      desktopPath: path.join(this.root, 'Profiles', id, 'Desktop'), codePath: path.join(this.root, 'Profiles', id, 'Code') };
  }
  load() {
    if (fs.existsSync(this.file)) {
      let doc;
      try { doc = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch { fail('The profile registry could not be read. Your file was preserved. Restore profiles-v2.json from its backup before restarting.'); }
      this.validate(doc); this.state = doc; return this.snapshot();
    }
    const legacyFile = path.join(this.root, 'profiles.json');
    let doc = { schemaVersion: 2, profiles: [this.original(), this.managed({ name: 'Work', note: 'Your company account' })],
      archived: [], settings: { desktopExecutable: '', cliExecutable: '', theme: 'system' } };
    if (fs.existsSync(legacyFile)) {
      let legacy;
      try { legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8')); } catch { fail('The previous macOS profile registry is unreadable. It was left unchanged.'); }
      if (legacy.version !== 1 || !Array.isArray(legacy.profiles)) fail('Unsupported macOS registry. It was left unchanged.');
      doc.profiles = legacy.profiles.map(p => ({ id: p.id, name: p.name, note: p.note || '', color: p.color,
        original: p.isOriginal, imported: p.isImported, desktop: p.desktopEnabled, code: p.codeEnabled,
        desktopPath: canonical(p.desktopPath), codePath: canonical(p.codePath) }));
      doc.settings.desktopExecutable = legacy.settings?.claudeApplication || '';
      doc.settings.cliExecutable = legacy.settings?.claudeBinary || '';
    }
    this.commit(doc); return this.snapshot();
  }
  snapshot() { return structuredClone(this.state); }
  validate(doc) {
    if (doc?.schemaVersion !== 2) fail('Unsupported registry version. Update the app; the original file was preserved.');
    if (!Array.isArray(doc.profiles) || !Array.isArray(doc.archived) || !doc.settings) fail('Invalid profile registry. Your file was preserved.');
    if (doc.profiles.filter(p => p.original).length !== 1) fail('The original profile is missing or duplicated.');
    const ids = new Set(), names = new Set(), paths = new Set();
    for (const profile of doc.profiles) {
      if (!UUID.test(profile.id) || ids.has(profile.id)) fail('Invalid or duplicate profile identifier.');
      ids.add(profile.id);
      this.validateFields(profile);
      const name = profile.name.toLocaleLowerCase('en-US');
      if (names.has(name)) fail('A profile already has this name. Choose another name.');
      names.add(name);
      for (const field of ['desktopPath', 'codePath']) {
        const key = pathKey(profile[field]);
        if (paths.has(key)) fail('This folder already belongs to a profile.');
        paths.add(key);
      }
      if (profile.original) {
        const original = this.original();
        if (pathKey(original.desktopPath) !== pathKey(profile.desktopPath) || pathKey(original.codePath) !== pathKey(profile.codePath)) fail('The original profile paths cannot be changed.');
      } else if (!profile.imported) {
        for (const [field, folder] of [['desktopPath', 'Desktop'], ['codePath', 'Code']]) {
          if (path.resolve(profile[field]) !== path.join(this.root, 'Profiles', profile.id, folder)) fail('Invalid managed profile folder.');
        }
      }
    }
    if (!['system', 'light', 'dark'].includes(doc.settings.theme)) fail('Invalid appearance setting.');
    for (const field of ['desktopExecutable', 'cliExecutable']) {
      const value = doc.settings[field];
      if (typeof value !== 'string' || control.test(value) || (value && !path.isAbsolute(value))) fail('Choose an absolute executable path.');
    }
  }
  validateFields(p, editing = false) {
    if (typeof p.name !== 'string' || p.name !== p.name.trim() || !p.name || [...graphemes.segment(p.name)].length > 48 || control.test(p.name)) fail('Use a name from 1 to 48 characters, without control characters.');
    // Native v1 labels had no length or control-character restrictions. Preserve
    // them when loading, migrating, archiving and changing unrelated profiles.
    if (typeof p.note !== 'string' || (editing && (p.note.length > 200 || control.test(p.note)))) fail('Keep the optional label under 200 characters on one line.');
    if (!COLORS.includes(p.color)) fail('Choose a profile color.');
    if (typeof p.desktop !== 'boolean' || typeof p.code !== 'boolean' || (!p.desktop && !p.code)) fail('Enable Desktop, Code, or both.');
    if (typeof p.original !== 'boolean' || typeof p.imported !== 'boolean') fail('Invalid profile type.');
  }
  commit(doc) {
    this.validate(doc);
    privateFolder(this.root);
    if (this.state) privateJSON(`${this.file}.backup`, this.state);
    privateJSON(this.file, doc); this.state = doc;
  }
  get(id) { return this.state.profiles.find(p => p.id === id) || fail('This profile no longer exists. Refresh the list.'); }
  save(input) {
    const doc = this.snapshot();
    const existing = input.id ? this.get(input.id) : null;
    const profile = { ...(existing || this.managed()), name: String(input.name ?? '').trim(),
      note: String(input.note ?? '').trim(), color: input.color, desktop: input.desktop, code: input.code };
    this.validateFields(profile, !existing || profile.note !== existing.note);
    if (existing) doc.profiles[doc.profiles.findIndex(p => p.id === existing.id)] = profile;
    else doc.profiles.push(profile);
    this.commit(doc); return profile;
  }
  remove(id) {
    const profile = this.get(id);
    if (profile.original) fail('The original profile cannot be removed.');
    const doc = this.snapshot(); doc.profiles = doc.profiles.filter(p => p.id !== id);
    doc.archived.push(profile); this.commit(doc);
  }
  restore(id) {
    const doc = this.snapshot(); const profile = doc.archived.find(p => p.id === id);
    if (!profile) fail('No archived profile found.');
    doc.profiles.push(profile); doc.archived = doc.archived.filter(p => p.id !== id);
    this.commit(doc);
  }
  saveSettings(input) {
    const doc = this.snapshot();
    doc.settings = { desktopExecutable: String(input.desktopExecutable ?? '').trim(), cliExecutable: String(input.cliExecutable ?? '').trim(), theme: input.theme };
    this.commit(doc);
  }
  import(input) {
    if (!input.desktopPath && !input.codePath) fail('Choose at least one existing profile folder.');
    const profile = this.managed({ ...input, desktop: !!input.desktopPath, code: !!input.codePath });
    profile.name = String(input.name ?? '').trim(); profile.note = 'Imported profile'; profile.imported = true;
    for (const field of ['desktopPath', 'codePath']) if (input[field]) {
      const value = canonical(input[field]);
      if (!fs.statSync(value).isDirectory()) fail('Choose an existing folder.');
      profile[field] = value;
    }
    const doc = this.snapshot(); doc.profiles.push(profile); this.commit(doc); return profile;
  }
  prepare(id, service) {
    const profile = this.get(id);
    if (profile.original) return;
    const field = service === 'desktop' ? 'desktopPath' : 'codePath';
    const folder = service === 'desktop' ? 'Desktop' : 'Code';
    const expected = path.join(this.root, 'Profiles', profile.id, folder);
    if (profile.imported && profile[field] !== expected) {
      if (!fs.statSync(profile[field]).isDirectory()) fail('The imported folder no longer exists.');
      return;
    }
    if (profile[field] !== expected || canonical(expected) !== expected) fail('A managed profile path was redirected. No files were written.');
    privateFolder(expected);
  }
  discover() {
    const known = new Set(this.state.profiles.flatMap(p => [pathKey(p.desktopPath), pathKey(p.codePath)]));
    const result = [];
    for (const [folder, prefix, kind] of [[path.dirname(this.context.originalDesktop), 'Claude-', 'desktop'], [this.home, '.claude-', 'code']]) {
      let items; try { items = fs.readdirSync(folder, { withFileTypes: true }); } catch { continue; }
      for (const item of items) if (item.isDirectory() && !item.isSymbolicLink() && item.name.startsWith(prefix)) {
        const full = canonical(path.join(folder, item.name));
        if (!known.has(pathKey(full))) result.push({ name: item.name.slice(prefix.length), path: full, kind });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
}
