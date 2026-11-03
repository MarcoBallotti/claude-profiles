import { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, ipcMain, dialog, shell, clipboard, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProfileStore, canonical } from './core/store.mjs';
import { copyPreferences } from './core/preferences.mjs';
import { cliCommand } from './core/platform.mjs';
import { Launcher } from './launcher.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(base, 'renderer', 'index.html');
const assets = path.join(base, '..', 'assets');
const previewIndex = process.argv.indexOf('--preview-root');
const preview = previewIndex !== -1;
const previewRoot = preview ? process.argv[previewIndex + 1] : null;
if (preview && (!previewRoot || !path.isAbsolute(previewRoot))) throw new Error('--preview-root requires an absolute path.');
// Keep Chromium caches away from both Claude's data and the original native app's registry.
if (preview) app.setPath('userData', path.join(previewRoot, 'Shell'));
let window, tray, store, launcher, loadError, quitting = false, timer;
let status = { running: [], statusAvailable: false };
const selectedFolders = new Set();
const selectedExecutables = new Set();
const busy = new Set();

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(initialize).catch(error => { dialog.showErrorBox('Claude Profiles', error.message); app.quit(); });
}

async function initialize() {
  store = new ProfileStore(preview ? { root: previewRoot } : {});
  try { store.load(); } catch (error) { loadError = error.message; }
  launcher = new Launcher(store, { preview });
  nativeTheme.themeSource = store.state?.settings.theme || 'system';
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // This app renders only local assets. OAuth happens in Claude, never in our renderer.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  createWindow(); createTray(); createMenu();
  if (!loadError) await refreshStatus();
  timer = setInterval(refreshStatus, 10000); timer.unref();
}

function createWindow() {
  window = new BrowserWindow({ width: 1060, height: 800, minWidth: 760, minHeight: 610,
    title: 'Claude Profiles', backgroundColor: nativeTheme.shouldUseDarkColors ? '#20211f' : '#faf9f6',
    icon: path.join(assets, 'icon.png'), show: false,
    webPreferences: { preload: path.join(base, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('close', event => { if (!quitting && tray) { event.preventDefault(); window.hide(); } });
  window.on('closed', () => { window = null; });
  window.loadFile(renderer);
}
function showWindow(target) {
  if (!window || window.isDestroyed()) createWindow();
  window.show(); window.focus();
  if (target) window.webContents.send('profiles:navigate', target);
}
function changed() {
  if (window && !window.isDestroyed()) window.webContents.send('profiles:changed');
  updateTray();
}
async function refreshStatus() {
  if (!store?.state || busy.has('status')) return;
  busy.add('status');
  try {
    const next = await launcher.status();
    if (JSON.stringify(next) !== JSON.stringify(status)) { status = next; changed(); }
  } finally { busy.delete('status'); }
}
function createTray() {
  try {
    const source = nativeImage.createFromPath(path.join(assets, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
    const icon = process.platform === 'darwin' ? source.resize({ width: 18, height: 18 }) : source;
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon); tray.setToolTip('Claude Profiles');
    tray.on('click', () => showWindow()); updateTray();
  } catch { tray = null; }
}
async function trayLaunch(action, id) {
  try { await launch(action, id); } catch (error) { dialog.showErrorBox('Could not open Claude', error.message); }
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Claude Profiles', enabled: false },
    ...(store?.state?.profiles || []).map(profile => ({ label: profile.name, type: 'submenu', submenu: [
      ...(profile.desktop ? [{ label: status.running.includes(profile.id) ? 'Show Desktop' : 'Open Desktop', click: () => trayLaunch('desktop', profile.id) }] : []),
      ...(profile.code ? [{ label: 'Open Claude Code', click: () => trayLaunch('code', profile.id) }] : []),
      { type: 'separator' }, { label: 'Manage profile', click: () => showWindow(profile.id) },
    ] })),
    { type: 'separator' }, { label: 'Manage profiles…', click: () => showWindow() },
    { label: 'New profile…', click: () => showWindow('new'), enabled: !loadError },
    { type: 'separator' }, { label: 'Quit Claude Profiles', click: () => app.quit() },
  ]));
}
function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Profiles', submenu: [
      { label: 'New profile…', accelerator: 'CmdOrCtrl+N', click: () => showWindow('new') },
      { label: 'Import profile…', click: () => showWindow('import') },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => showWindow('settings') },
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'How it works', click: () => showWindow('help') }, { label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/MarcoBallotti/claude-profiles') }] },
  ]));
}

async function launch(kind, id, directory) {
  if (busy.has(id)) throw new Error('This profile is already opening. Try again in a moment.');
  busy.add(id); changed();
  try {
    if (kind === 'desktop') await launcher.desktop(id);
    else await launcher.terminal(id, directory);
    setTimeout(refreshStatus, 1200).unref();
  } finally { busy.delete(id); changed(); }
}

ipcMain.handle('profiles:action', async (event, action, input = {}) => {
  try {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        fileURLToPath(event.senderFrame.url) !== renderer) throw new Error('Untrusted request.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request.');
    if (loadError && !['state', 'openDocs', 'reveal'].includes(action)) throw new Error(loadError);
    let value;
    switch (action) {
      case 'state': value = { ...(store.state || { profiles: [], archived: [], settings: {} }), ...status,
        platform: process.platform, version: app.getVersion(), preview, loadError, root: store.root,
        busy: [...busy].filter(id => id !== 'status'), installed: loadError ? {} : await launcher.detect() }; break;
      case 'saveProfile': value = store.save(input); changed(); break;
      case 'removeProfile': store.remove(input.id); changed(); break;
      case 'restoreProfile': store.restore(input.id); changed(); break;
      case 'saveSettings':
        for (const key of ['desktopExecutable', 'cliExecutable']) if (input[key] && input[key] !== store.state.settings[key] && !selectedExecutables.has(input[key])) throw new Error('Choose an executable using the file picker.');
        store.saveSettings(input); nativeTheme.themeSource = input.theme; changed(); break;
      case 'launchDesktop': await launch('desktop', input.id); break;
      case 'launchCode': {
        let directory;
        if (input.chooseProject) {
          const result = await dialog.showOpenDialog(window, { title: 'Choose a project', properties: ['openDirectory'] });
          if (result.canceled) return { ok: true, value: null };
          directory = result.filePaths[0];
        }
        await launch('code', input.id, directory); break;
      }
      case 'copyCommand': {
        const binary = (await launcher.detect()).code;
        if (!binary) throw new Error('Choose the Claude Code executable in Settings first.');
        clipboard.writeText(cliCommand(store.get(input.id), binary)); break;
      }
      case 'copyPreferences': {
        if (preview) throw new Error('Copying personal files is disabled in preview mode.');
        const profile = store.get(input.id);
        if (profile.original) throw new Error('Choose a separate profile first.');
        store.prepare(profile.id, 'code');
        value = copyPreferences(store.original().codePath, profile.codePath, { instructions: input.instructions === true, preferences: input.preferences === true }); break;
      }
      case 'discover': value = store.discover(); for (const item of value) selectedFolders.add(item.path); break;
      case 'importProfile':
        for (const key of ['desktopPath', 'codePath']) if (input[key] && !selectedFolders.has(input[key])) throw new Error('Choose the existing folder using the file picker.');
        value = store.import(input); changed(); break;
      case 'choosePath': {
        if (!['folder', 'desktop', 'code'].includes(input.kind)) throw new Error('Unknown path type.');
        const result = await dialog.showOpenDialog(window, { title: input.kind === 'folder' ? 'Choose a profile folder' : 'Choose the Claude application or executable',
          properties: [input.kind === 'folder' ? 'openDirectory' : 'openFile', 'showHiddenFiles'],
          ...(input.kind === 'desktop' && process.platform === 'darwin' ? { filters: [{ name: 'Application', extensions: ['app'] }] } : {}),
        });
        value = result.canceled ? null : canonical(result.filePaths[0]);
        if (value) (input.kind === 'folder' ? selectedFolders : selectedExecutables).add(value); break;
      }
      case 'reveal': {
        const target = input.id ? store.get(input.id)[input.kind === 'desktop' ? 'desktopPath' : 'codePath'] : store.root;
        if (!fs.existsSync(target)) throw new Error('This folder is created the first time you open the profile.');
        shell.showItemInFolder(target); break;
      }
      case 'openDocs': await shell.openExternal('https://github.com/MarcoBallotti/claude-profiles#readme'); break;
      default: throw new Error('Unknown action.');
    }
    return { ok: true, value };
  } catch (error) { return { ok: false, error: error.message || 'The action could not be completed.' }; }
});

app.on('activate', () => showWindow());
app.on('before-quit', () => { quitting = true; if (timer) clearInterval(timer); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
