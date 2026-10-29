import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
for (const file of ['index.html','favicon.svg','src','assets','server.mjs','server','package.json','package-lock.json','README.md']) await cp(file, `dist/${file}`, {recursive:true});
console.log('Build complete: dist/ (game client, online server, original assets and locked dependencies)');
