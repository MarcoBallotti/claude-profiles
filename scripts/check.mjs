import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let count = 0;
function scan(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.(mjs|cjs|js)$/.test(file)) { execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' }); count++; }
  }
}
for (const folder of ['src', 'test', 'scripts']) scan(path.join(root, folder));
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
if (!html.includes("connect-src 'none'") || !html.includes('Content-Security-Policy')) throw new Error('Missing offline Content Security Policy.');
console.log(`Syntax checked ${count} JavaScript files; offline CSP present.`);
