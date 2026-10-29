import http from 'node:http';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import {createGameServer} from '../server.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_PATH || 'playwright'); }
catch { playwright = require(os.homedir() + '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, 'dist-static');
const artifacts = path.join(root, 'artifacts');
const checks = [], errors = [], sockets = [];
const started = Date.now();
let browser, frontend, game, host, guest, offline;
let frontendOrigin, backendOrigin;
const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.wav':'audio/wav', '.mp3':'audio/mpeg', '.ttf':'font/ttf', '.swf':'application/x-shockwave-flash'};
const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
const state = page => page.evaluate(() => window.flashVersus.getState());

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve('http://127.0.0.1:' + server.address().port);
    });
  });
}

async function ready(page, suffix = '') {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(frontendOrigin + suffix, {waitUntil:'networkidle'});
  await page.waitForFunction(() => window.flashVersus && !document.querySelector('#loading-state').checkVisibility());
}

async function connectPage(page) {
  await page.bringToFront();
  await page.locator('[data-mode="multiplayer"]').click();
  await page.locator('[data-multiplayer="online"]').click();
}

function rejectUnlistedOrigin(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint, {origin:'https://unlisted.invalid'});
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error('Origin rejection timed out')); }, 3000);
    socket.on('error', () => {});
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout); response.resume(); socket.terminate(); resolve(response.statusCode);
    });
    socket.once('open', () => { clearTimeout(timeout); socket.terminate(); reject(new Error('Unlisted origin was accepted')); });
  });
}

try {
  await mkdir(artifacts, {recursive:true});
  await readFile(path.join(output, 'index.html'));
  frontend = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(output, '.' + pathname);
      const relative = path.relative(output, file).split(path.sep).join('/');
      if (!file.startsWith(output + path.sep) || !['index.html','favicon.svg'].includes(relative) && !/^(assets|src)\//.test(relative)) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const content = await readFile(file);
      response.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
      response.end(content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  frontendOrigin = await listen(frontend);
  game = createGameServer({allowedOrigins:[frontendOrigin], versusMs:20});
  backendOrigin = await listen(game.server);
  const endpoint = backendOrigin.replace('http:', 'ws:') + '/online';
  check(frontendOrigin !== backendOrigin, 'Static frontend and Node backend use separate origins');
  check((await rejectUnlistedOrigin(endpoint)) === 403, 'Backend rejects a WebSocket from an unlisted origin');
  check((await fetch(frontendOrigin + '/server.mjs')).status === 404, 'Static deployment does not serve server source');
  check((await fetch(frontendOrigin + '/package.json')).status === 404, 'Static deployment does not serve package metadata');
  const asset = await fetch(frontendOrigin + '/assets/fonts/Gaegu-Regular.ttf');
  check(asset.status === 200 && asset.headers.get('content-type') === 'font/ttf', 'Static deployment serves game assets with their MIME type');
  await asset.arrayBuffer();

  browser = await playwright.chromium.launch({headless:true, channel:'msedge'});
  const hostContext = await browser.newContext({viewport:{width:1440,height:900}});
  const guestContext = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  for (const context of [hostContext, guestContext]) {
    context.setDefaultTimeout(6000);
    // Only the generated endpoint response is replaced to simulate local TLS
    // termination. All game modules, styles and assets come from dist-static/.
    await context.route('**/src/deployment.js', route => route.fulfill({status:200,contentType:'text/javascript',body:`export const ONLINE_URL = ${JSON.stringify(endpoint)};\n`}));
  }
  host = await hostContext.newPage(); guest = await guestContext.newPage();
  for (const page of [host, guest]) page.on('websocket', socket => sockets.push(socket.url()));
  await Promise.all([ready(host), ready(guest)]);
  await connectPage(host); await host.locator('#create-room').click();
  await host.waitForFunction(() => Boolean(window.flashVersus.getState().online.code));
  const code = (await state(host)).online.code;
  check(/^[A-Z2-9]{6}$/.test(code), 'Host creates a six-character private room through the separate backend');
  await connectPage(guest); await guest.locator('#room-code-input').fill(code); await guest.locator('#join-room').click();
  await Promise.all([host,guest].map(page => page.waitForFunction(() => window.flashVersus.getState().menu.screen === 'characters')));
  check((await state(host)).online.seat === 0 && (await state(guest)).online.seat === 1, 'Independent browser contexts own separate player seats');
  await host.bringToFront(); await host.locator('[data-fighter="cross"]').click();
  await guest.bringToFront(); await guest.locator('[data-fighter="emerald"]').click();
  await Promise.all([host,guest].map(page => page.waitForFunction(() => window.flashVersus.getState().menu.screen === 'stage')));
  check(await guest.locator('[data-stage="paper"]').isDisabled(), 'Only the host controls stage selection');
  await host.bringToFront(); await host.locator('[data-stage="paper"]').click();
  await Promise.all([host,guest].map(page => page.waitForFunction(() => window.flashVersus.getState().phase === 'fighting')));
  const roster = (await state(host)).players.map(player => player.id);
  check(JSON.stringify(roster) === JSON.stringify(['cross','emerald']) && JSON.stringify(roster) === JSON.stringify((await state(guest)).players.map(player => player.id)), 'Both clients enter the same selected fight');

  const positions = (await state(host)).players.map(player => player.x);
  await host.keyboard.down('d'); await host.waitForTimeout(270); await host.keyboard.up('d');
  await host.waitForFunction(x => window.flashVersus.getState().players[0].x > x, positions[0]);
  check(game.online.rooms.get(code).engine.players[0].x > positions[0], 'Host movement is calculated by the backend');
  await guest.bringToFront(); await guest.keyboard.down('a'); await guest.waitForTimeout(270); await guest.keyboard.up('a');
  await host.waitForFunction(x => window.flashVersus.getState().players[1].x < x, positions[1]);
  check(game.online.rooms.get(code).engine.players[1].x < positions[1], 'Guest uses its own WASD controls across origins');
  await host.bringToFront(); await host.keyboard.down('d');
  await host.waitForFunction(() => { const p=window.flashVersus.getState().players; return Math.abs(p[1].x-p[0].x) < 95; });
  await host.keyboard.up('d');
  const beforeHp = (await state(host)).players[1].hp;
  await host.keyboard.press('j');
  await host.waitForFunction(hp => window.flashVersus.getState().players[1].hp < hp, beforeHp);
  const health = game.online.rooms.get(code).engine.players[1].hp;
  await Promise.all([host,guest].map(page => page.waitForFunction(hp => window.flashVersus.getState().players[1].hp === hp, health)));
  check((await state(host)).players[1].hp === (await state(guest)).players[1].hp && health < beforeHp, 'Both clients show identical authoritative damage');

  await guest.route('**/src/main.js', async route => { await new Promise(resolve => setTimeout(resolve,700)); await route.continue(); });
  const reload = guest.reload({waitUntil:'domcontentloaded'});
  await host.waitForFunction(() => window.flashVersus.getState().paused);
  const remaining = (await state(host)).remaining;
  await host.waitForTimeout(120);
  check((await state(host)).remaining === remaining, 'Disconnect freezes the shared match clock');
  await reload; await guest.unroute('**/src/main.js');
  await guest.waitForFunction(() => window.flashVersus?.getState().online.status === 'connected' && window.flashVersus.getState().online.phase === 'battle');
  await host.waitForFunction(() => !window.flashVersus.getState().paused);
  check((await state(guest)).online.code === code && (await state(guest)).online.seat === 1 && (await state(guest)).players[1].hp === health, 'Reload reconnects to the same cross-origin room, seat and health');
  check(sockets.length >= 3 && sockets.every(url => url === endpoint), 'Initial and resumed WebSockets all use the configured backend');
  await hostContext.close(); await guestContext.close();
  console.log('Cross-origin room, fighting, movement, shared damage and reload recovery passed.');

  const offlineContext = await browser.newContext({viewport:{width:1440,height:900}});
  offlineContext.setDefaultTimeout(6000);
  await offlineContext.route('**/src/deployment.js', route => route.fulfill({status:200,contentType:'text/javascript',body:'export const ONLINE_URL = null;\n'}));
  await offlineContext.addInitScript(() => {
    sessionStorage.setItem('flash-versus-online-seat-v1', JSON.stringify({code:'ABC234',token:'stale-test-seat'}));
    window.__webSocketAttempts = 0;
    window.WebSocket = new Proxy(window.WebSocket, {construct(target, args) { window.__webSocketAttempts++; return new target(...args); }});
  });
  offline = await offlineContext.newPage(); await ready(offline, '?room=ABC234');
  check((await state(offline)).menu.screen === 'mode', 'Unconfigured online ignores stale room links and saved seats');
  await offline.locator('[data-mode="cpu"]').click();
  await offline.locator('[data-fighter="tuna"]').click(); await offline.locator('[data-fighter="hacker"]').click();
  await offline.locator('[data-stage="paper"]').click();
  await offline.locator('#game-shell').focus(); await offline.keyboard.press('Enter');
  await offline.waitForFunction(() => window.flashVersus.getState().menu.screen === 'battle');
  check((await state(offline)).menu.mode === 'cpu', 'CPU battle is playable with online unconfigured');
  await offline.locator('#brand-button').click(); await offline.locator('#home-button').click();
  await offline.locator('[data-mode="multiplayer"]').click();
  check(await offline.locator('[data-multiplayer="online"]').isDisabled(), 'Unconfigured online card is disabled');
  check((await offline.locator('[data-multiplayer="online"]').innerText()).includes('준비 중'), 'Disabled online card explains its status');
  await offline.locator('#game-shell').focus(); await offline.keyboard.press('ArrowLeft'); await offline.keyboard.press('ArrowRight');
  check(await offline.locator('[data-multiplayer="local"]').evaluate(element => element.classList.contains('selected')), 'Keyboard navigation keeps the available local mode selected');
  await offline.keyboard.press('Enter');
  await offline.waitForFunction(() => window.flashVersus.getState().menu.screen === 'characters' && window.flashVersus.getState().menu.mode === 'local');
  await offline.locator('[data-fighter="tuna"]').click(); await offline.locator('[data-fighter="hacker"]').click();
  await offline.locator('[data-stage="paper"]').click(); await offline.locator('#game-shell').focus(); await offline.keyboard.press('Enter');
  await offline.waitForFunction(() => window.flashVersus.getState().menu.screen === 'battle');
  check((await state(offline)).menu.mode === 'local', 'Same-device two-player battle is playable with online unconfigured');
  check(await offline.evaluate(() => window.__webSocketAttempts === 0), 'Unconfigured online makes no WebSocket connection attempts');
  check(errors.length === 0, 'No browser runtime or console errors: ' + errors.join('; '));
  await writeFile(path.join(artifacts,'deployment-results.json'), JSON.stringify({passed:true,checks,errors,frontendOrigin,backendOrigin,durationMs:Date.now()-started},null,2));
  console.log('Deployment browser checks passed: ' + checks.length + '. Results: artifacts/deployment-results.json');
} catch (error) {
  await mkdir(artifacts, {recursive:true});
  for (const [page,name] of [[host,'host'],[guest,'guest'],[offline,'offline']]) {
    if (page && !page.isClosed()) await page.screenshot({path:path.join(artifacts,'deployment-failure-'+name+'.png')}).catch(() => {});
  }
  await writeFile(path.join(artifacts,'deployment-results.json'), JSON.stringify({passed:false,error:error.message,checks,errors,frontendOrigin,backendOrigin,durationMs:Date.now()-started},null,2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (game) await game.close();
  if (frontend) { frontend.closeAllConnections(); await new Promise(resolve => frontend.close(resolve)); }
}
