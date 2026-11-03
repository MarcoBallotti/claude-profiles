const $ = selector => document.querySelector(selector);
const icons = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  drive: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 13h18M7 16h.01M11 16h.01"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  settings: '<path d="M5 4v16M12 4v16M19 4v16"/><path d="M2 8h6m1 8h6m1-9h6"/>',
  desktop: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 9 3 3-3 3m7 0h5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
  key: '<circle cx="7.5" cy="9" r="4.5"/><path d="m11 12 9 9m-4-4 3-3m-6 0 3-3"/>',
  folder: '<path d="M3 7V5h6l2 3h10v12H3V7Z"/>',
  arrow: '<path d="M14 4h6v6m-10 4L20 4M10 4H4v16h16v-6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  circle: '<circle cx="12" cy="12" r="6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.circle}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => [...name.trim().split(/\s+/).slice(0, 2).map(word => [...word][0])].join('').toLocaleUpperCase();
const avatar = (p, large = false) => `<div class="avatar ${escape(p.color)}${large ? ' large' : ''}" aria-hidden="true">${escape(initials(p.name))}</div>`;
const colors = ['terracotta', 'sage', 'blue', 'plum', 'amber', 'graphite'];
let state, selected, undoID, dialogTask, refreshSequence = 0;
let dialogBusy = false;
const dialog = $('#dialog');

async function request(action, payload) {
  const response = await window.profiles.invoke(action, payload);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
function notice(message, error = false, undo) {
  $('#notice-text').textContent = message; $('#notice').dataset.error = String(error);
  $('#notice').hidden = false; undoID = undo;
  $('#notice-action').hidden = !undo;
}
async function refresh() {
  const seq = ++refreshSequence;
  try {
    const next = await request('state');
    if (seq !== refreshSequence) return;
    state = next;
    if (!state.profiles.some(p => p.id === selected)) selected = state.profiles.find(p => !p.original)?.id || state.profiles[0]?.id;
    document.documentElement.dataset.theme = state.settings.theme || 'system';
    $('#content').setAttribute('aria-busy', 'false');
    $('#new-profile').disabled = !!state.loadError; $('#import-profile').disabled = !!state.loadError;
    $('#settings').disabled = !!state.loadError;
    if (state.preview) $('#local-label').textContent = 'Preview · launches disabled';
    renderList(); renderDetail();
    $('#footer').textContent = `Desktop ${state.installed.desktop ? 'detected' : 'not found'}  ·  Code ${state.installed.code ? 'detected' : 'not found'}  ·  ${state.platform === 'darwin' ? 'macOS' : state.platform === 'win32' ? 'Windows' : 'Linux'}  ·  v${state.version}`;
  } catch (error) { notice(error.message, true); }
}
function renderList() {
  const query = $('#search').value.toLocaleLowerCase();
  const profiles = state.profiles.filter(p => `${p.name} ${p.note}`.toLocaleLowerCase().includes(query));
  $('#profile-count').textContent = state.profiles.length;
  $('#profile-list').innerHTML = profiles.map(p => `<button class="profile-row" data-select="${escape(p.id)}" aria-current="${p.id === selected}" title="${escape(p.name)}">
    ${avatar(p)}<span class="row-text"><strong>${escape(p.name)}</strong><small>${p.original ? 'Original profile' : p.imported ? 'Imported profile' : 'Separate workspace'}</small></span>
    ${state.running.includes(p.id) ? '<span class="open-dot" role="img" aria-label="Desktop open"></span>' : ''}</button>`).join('') || '<p class="empty">No profiles found.</p>';
}
function action(label, name, classes = 'secondary', disabled = false) {
  return `<button class="${classes}" data-action="${name}"${disabled ? ' disabled' : ''}>${label}</button>`;
}
function renderDetail() {
  if (state.loadError) {
    $('#content').innerHTML = `<h1>Your data is preserved.</h1><p class="error">${escape(state.loadError)}</p>${action('Open data folder', 'revealRoot')}`; return;
  }
  const p = state.profiles.find(item => item.id === selected);
  if (!p) { $('#content').innerHTML = '<p class="empty">Choose a profile to get started.</p>'; return; }
  const opening = state.busy.includes(p.id), open = state.running.includes(p.id);
  $('#content').innerHTML = `
    <div class="profile-heading">${avatar(p, true)}<div><h1>${escape(p.name)}</h1><p>${escape(p.note || 'An account. A space of its own.')}</p></div><button class="icon-button" data-action="edit" aria-label="Edit profile" title="Edit profile">${icon('edit')}</button></div>
    ${p.desktop ? `<section class="service" aria-labelledby="desktop-title"><div class="service-heading">${icon('desktop')}<div><h2 id="desktop-title">Claude Desktop</h2><p>Chat, Cowork and Code in this account’s own window.</p></div></div><div class="service-actions"><span class="status ${open ? 'open' : ''}">${icon(open ? 'check' : 'circle')}${!state.statusAvailable ? 'Status unavailable' : open ? 'Open' : 'Ready to open'}</span>${action(opening ? 'Opening…' : open ? 'Show Desktop' : 'Open Desktop', 'desktop', 'primary', opening || !state.installed.desktop)}</div></section>` : ''}
    ${p.code ? `<section class="service" aria-labelledby="code-title"><div class="service-heading">${icon('terminal')}<div><h2 id="code-title">Claude Code</h2><p>Your terminal, with this profile’s configuration.</p></div></div><div class="service-actions">${action('Copy command', 'command', 'text-button', !state.installed.code)}${action('Choose project…', 'project', '', opening || !state.installed.code)}${action(opening ? 'Opening…' : 'Open terminal', 'code', 'secondary', opening || !state.installed.code)}</div></section>` : ''}
    ${!p.original ? `<div class="utility-row">${icon('settings')}<div><h2>Make yourself at home.</h2><p>Bring your instructions, skills and preferences along.</p></div>${action('Choose what to copy', 'copy')}</div>` : ''}
    <details><summary>Profile folders</summary>${[['Desktop data', p.desktopPath, 'revealDesktop'], ['Code configuration', p.codePath, 'revealCode']].map(([label, value, target]) => `<div class="folder"><div><strong>${label}</strong><code>${escape(value)}</code></div><button class="icon-button" data-action="${target}" aria-label="Show ${label} folder">${icon('arrow')}</button></div>`).join('')}</details>
    <p class="hint">${icon(p.original ? 'check' : 'key')}<span>${p.original ? 'Your existing profile stays in its original folders. Its conversations, settings and sign-ins are not moved.' : 'Sign in once in Desktop and once in the terminal. They keep separate logins; this launcher never copies account credentials.'}</span></p>
    ${!state.installed.desktop || !state.installed.code ? `<p class="hint">An app is missing? ${action('Choose its path in Settings', 'settings', 'text-button')}</p>` : ''}`;
}
function openDialog(title, intro, body, submit, task) {
  $('#dialog-content').innerHTML = `<h2 id="dialog-title">${title}</h2><p class="intro">${intro}</p>${body}`;
  $('#submit-dialog').textContent = submit || 'Done'; $('#submit-dialog').disabled = false;
  $('#submit-dialog').hidden = !task;
  $('#cancel-dialog').textContent = task ? 'Cancel' : 'Close';
  $('#form-error').hidden = true; dialogTask = task;
  if (!dialog.open) dialog.showModal();
  const focus = dialog.querySelector('input:not([type=radio]):not([type=checkbox]), select, button');
  focus?.focus();
}
function field(label, name, value = '', placeholder = '', extra = '') {
  return `<label class="field">${label}<input name="${name}" value="${escape(value)}" placeholder="${escape(placeholder)}" ${extra}></label>`;
}
function checkbox(label, name, checked = true, help = '') {
  return `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span>${label}${help ? `<small>${help}</small>` : ''}</span></label>`;
}
function profileEditor(profile) {
  openDialog(profile ? 'Edit your profile' : 'A new space.', 'A name and a color make each account easy to recognize.', `
    ${field('Profile name', 'name', profile?.name, 'Work, Personal, Studio', 'required')}
    <label class="field">Optional label<textarea name="note" rows="2" placeholder="An email or company name">${escape(profile?.note || '')}</textarea></label>
    <p class="disclaimer">This is your label, not a verified account identity.</p>
    <fieldset><legend>Color</legend><div class="colors">${colors.map(color => `<label class="color-option" title="${color}"><input type="radio" name="color" value="${color}" aria-label="${color}" ${(profile?.color || 'sage') === color ? 'checked' : ''}><span class="avatar ${color}"></span></label>`).join('')}</div></fieldset>
    <fieldset><legend>Use this profile with</legend>${checkbox('Claude Desktop', 'desktop', profile?.desktop ?? true)}${checkbox('Claude Code in the terminal', 'code', profile?.code ?? true)}</fieldset>
    ${profile && !profile.original ? '<button type="button" class="danger" id="remove-profile">Remove from list</button><p class="disclaimer">Removing a profile keeps its data. Restore it from Settings.</p>' : ''}`,
  profile ? 'Save changes' : 'Create profile', async data => {
    const result = await request('saveProfile', { id: profile?.id, name: data.get('name'), note: data.get('note'), color: data.get('color'), desktop: data.has('desktop'), code: data.has('code') });
    selected = result.id; await refresh();
  });
  $('#remove-profile')?.addEventListener('click', async () => {
    try { await request('removeProfile', { id: profile.id }); dialog.close(); await refresh(); notice(`${profile.name} removed from the list. Its files were kept.`, false, profile.id); }
    catch (error) { formError(error); }
  });
}
function pathInput(label, name, value, kind) {
  return `<label class="field">${label}<span class="path-input"><input name="${name}" value="${escape(value)}" placeholder="Automatic detection" readonly><button type="button" class="secondary" data-pick="${kind}" data-field="${name}">Choose…</button><button type="button" class="icon-button" data-clear="${name}" aria-label="Clear ${label}">${icon('close')}</button></span></label>`;
}
function bindPickers() {
  dialog.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', async () => {
    try {
      const value = await request('choosePath', { kind: button.dataset.pick });
      if (value) dialog.querySelector(`[name="${button.dataset.field}"]`).value = value;
    } catch (error) { formError(error); }
  }));
  dialog.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', () => { dialog.querySelector(`[name="${button.dataset.clear}"]`).value = ''; }));
}
function settings() {
  openDialog('The apps on your device', 'Claude Profiles opens the Claude applications you already use.', `
    ${pathInput('Claude Desktop application', 'desktopExecutable', state.settings.desktopExecutable, 'desktop')}
    ${pathInput('Claude Code executable', 'cliExecutable', state.settings.cliExecutable, 'code')}
    <p class="disclaimer">Empty paths use automatic detection. On Windows, select the native claude.exe installer rather than an npm .cmd wrapper.</p>
    <label class="field">Appearance<select name="theme">${['system', 'light', 'dark'].map(theme => `<option value="${theme}" ${state.settings.theme === theme ? 'selected' : ''}>${theme[0].toUpperCase() + theme.slice(1)}</option>`).join('')}</select></label>
    ${state.archived.length ? `<details><summary>Removed profiles (${state.archived.length})</summary>${state.archived.map(p => `<div class="folder"><span>${escape(p.name)}</span><button type="button" class="secondary" data-restore="${escape(p.id)}">Restore</button></div>`).join('')}</details>` : ''}
    <p class="disclaimer">Closing the window keeps the tray menu available. Quit from the menu to stop this launcher; Claude stays open.</p>`, 'Save', async data => {
    await request('saveSettings', Object.fromEntries(data)); await refresh();
  });
  bindPickers();
  dialog.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', async () => {
    try { await request('restoreProfile', { id: button.dataset.restore }); await refresh(); settings(); } catch (error) { formError(error); }
  }));
}
async function importProfile() {
  try {
    const found = await request('discover');
    openDialog('Bring your profiles over.', 'Connect their existing folders. Nothing is moved or deleted.', `
      ${found.length ? `<div class="discover-list">${found.map((p, index) => `<button type="button" data-discovered="${index}"><span>${escape(p.name)}</span><span>${p.kind === 'desktop' ? 'Desktop' : 'Code'}</span></button>`).join('')}</div>` : '<p class="disclaimer">No additional folders detected. Choose them below.</p>'}
      ${field('Profile name', 'name', '', 'Existing profile', 'required')}
      ${pathInput('Desktop data folder (optional)', 'desktopPath', '', 'folder')}
      ${pathInput('Code configuration folder (optional)', 'codePath', '', 'folder')}
      <p class="disclaimer">Select the original data folders, not Claude.app. If you import only Desktop, its Code tab gets a new configuration folder; select the existing Code folder too to keep using it.</p>`, 'Import profile', async data => {
      const profile = await request('importProfile', { ...Object.fromEntries(data), color: 'blue' });
      selected = profile.id; await refresh();
    });
    bindPickers();
    dialog.querySelectorAll('[data-discovered]').forEach(button => button.addEventListener('click', () => {
      const item = found[Number(button.dataset.discovered)];
      dialog.querySelector('[name="name"]').value = item.name;
      dialog.querySelector(`[name="${item.kind === 'desktop' ? 'desktopPath' : 'codePath'}"]`).value = item.path;
    }));
  } catch (error) { notice(error.message, true); }
}
function copyDialog(profile) {
  openDialog('Bring your habits along.', `Independent copies from Personal to ${escape(profile.name)}.`, `
    ${checkbox('Instructions and skills', 'instructions', true, 'CLAUDE.md, skills, agents, commands, rules and output-styles.')}
    ${checkbox('Usage preferences', 'preferences', true, 'Model, language, reasoning and supported display preferences.')}
    <p class="disclaimer">Credentials, history, MCP servers, plugins, hooks, permissions and environment variables are excluded. Existing files and symbolic links are skipped.</p>`, 'Copy selected files', async data => {
    if (!data.has('instructions') && !data.has('preferences')) throw new Error('Select at least one category.');
    const result = await request('copyPreferences', { id: profile.id, instructions: data.has('instructions'), preferences: data.has('preferences') });
    notice(`${result.copied.length} files copied. ${result.skipped.length} existing or linked items skipped.`);
  });
}
function help() {
  openDialog('A sign-in for every space.', 'Personal and work accounts, side by side.', `
    <div class="help-step"><h3>Start with Personal or Work</h3><p>Personal uses your existing installation’s default folders. Other profiles use their own Desktop and Code directories.</p></div>
    <div class="help-step"><h3>Sign in once per surface</h3><p>Open Desktop and sign into the right account. Use a private browser window if the wrong account is suggested. Desktop and the CLI need separate first-time logins.</p></div>
    <div class="help-step"><h3>Keep both open</h3><p>Launch profiles from this window or the system tray. If OAuth returns to the wrong Claude window, close the other Claude instances temporarily while signing in.</p></div>
    <p class="disclaimer">This launcher is independent of Anthropic. Desktop profile launching uses an undocumented compatibility mechanism that may change. Device-wide company policies still apply. Keyless Console logins and third-party providers need additional configuration. Windows uses native PowerShell and Claude Code, not WSL. A profile is not a filesystem sandbox.</p>
    <button type="button" class="text-button" id="open-docs">Read the documentation on GitHub ${icon('arrow')}</button>`, null, null);
  $('#open-docs').addEventListener('click', () => request('openDocs').catch(error => formError(error)));
}
function formError(error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
$('#dialog-form').addEventListener('submit', async event => {
  event.preventDefault(); if (dialogBusy || !dialogTask) return;
  const task = dialogTask, button = $('#submit-dialog'), label = button.textContent;
  dialogBusy = true; button.disabled = true; button.textContent = 'Working…'; $('#cancel-dialog').disabled = true;
  $('#form-error').hidden = true;
  try { await task(new FormData(event.target)); dialog.close(); }
  catch (error) { formError(error); }
  finally { dialogBusy = false; button.disabled = false; button.textContent = label; $('#cancel-dialog').disabled = false; }
});
dialog.addEventListener('cancel', event => { if (dialogBusy) event.preventDefault(); });
$('#cancel-dialog').addEventListener('click', () => dialog.close());
$('#search').addEventListener('input', renderList);
$('#profile-list').addEventListener('click', event => {
  const button = event.target.closest('[data-select]');
  if (button) { selected = button.dataset.select; renderList(); renderDetail(); }
});
$('#content').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const profile = state.profiles.find(p => p.id === selected), name = button.dataset.action;
  try {
    if (name === 'edit') return profileEditor(profile);
    if (name === 'settings') return settings();
    if (name === 'copy') return copyDialog(profile);
    if (name.startsWith('reveal')) return await request('reveal', name === 'revealRoot' ? {} : { id: profile.id, kind: name === 'revealDesktop' ? 'desktop' : 'code' });
    button.disabled = true;
    if (name === 'desktop') await request('launchDesktop', { id: profile.id });
    if (name === 'code' || name === 'project') await request('launchCode', { id: profile.id, chooseProject: name === 'project' });
    if (name === 'command') { await request('copyCommand', { id: profile.id }); notice('Command copied. Paste it into your preferred terminal.'); }
    await refresh();
  } catch (error) { notice(error.message, true); button.disabled = false; }
});
$('#new-profile').addEventListener('click', () => profileEditor());
$('#settings').addEventListener('click', settings);
$('#help').addEventListener('click', help);
$('#import-profile').addEventListener('click', importProfile);
$('#close-notice').addEventListener('click', () => { $('#notice').hidden = true; });
$('#notice-action').addEventListener('click', async () => {
  try { await request('restoreProfile', { id: undoID }); await refresh(); $('#notice').hidden = true; } catch (error) { notice(error.message, true); }
});
window.profiles.onChange(refresh);
window.profiles.onNavigate(target => {
  if (!state || state.loadError) return;
  if (target === 'new') profileEditor(); else if (target === 'settings') settings(); else if (target === 'help') help();
  else if (target === 'import') importProfile(); else { selected = target; renderList(); renderDetail(); }
});
document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
await refresh();
