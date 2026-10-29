import {cp, lstat, mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = path.resolve(root, 'dist-static');

function onlineUrl(value) {
  if (!value?.trim()) return null;
  const input = value.trim();
  if (!/^(https|wss):\/\//i.test(input)) {
    throw new Error('ONLINE_SERVER_URL must be an absolute https:// or wss:// URL.');
  }
  let url;
  try { url = new URL(input); }
  catch { throw new Error('ONLINE_SERVER_URL must be an absolute https:// or wss:// URL.'); }
  if (!['https:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password || input.includes('#')) {
    throw new Error('ONLINE_SERVER_URL must use https:// or wss:// without credentials or a fragment.');
  }
  url.protocol = 'wss:';
  if (url.pathname === '/') url.pathname = '/online';
  return url.href;
}

// Validate deployment settings before removing or writing any existing build.
const endpoint = onlineUrl(process.env.ONLINE_SERVER_URL);
if (path.dirname(output) !== root || path.basename(output) !== 'dist-static') {
  throw new Error('Refusing to clean a directory outside the static build output.');
}
const previous = await lstat(output).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (previous?.isSymbolicLink()) throw new Error('Static build output must not be a symbolic link.');
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
for (const entry of ['index.html', 'favicon.svg', 'src', 'assets']) {
  await cp(path.join(root, entry), path.join(output, entry), {recursive: true});
}
await writeFile(path.join(output, 'src', 'deployment.js'), `export const ONLINE_URL = ${JSON.stringify(endpoint)};\n`);
console.log(`Vercel build complete: dist-static/ (online ${endpoint ? 'configured' : 'unavailable; local modes ready'})`);
