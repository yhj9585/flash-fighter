import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_PATH || 'playwright'); }
catch { playwright = require(os.homedir() + '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }

function publicUrl(value) {
  const url = new URL(value);
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return url.href;
}

function gameAddress(value) {
  if (!value) throw new Error('GAME_URL is required and must be an absolute https:// URL.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('GAME_URL must use https:// without credentials or a fragment.');
  }
  url.searchParams.delete('room');
  return url.href;
}

function backendAddress(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['https:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('BACKEND_URL must be an absolute https:// or wss:// URL without credentials or a fragment.');
  }
  url.protocol = 'wss:';
  if (url.pathname === '/') url.pathname = '/online';
  return url.href;
}

const gameUrl = gameAddress(process.env.GAME_URL);
const expectedBackend = backendAddress(process.env.BACKEND_URL);
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
const started = Date.now();
const checks = [], errors = [], sockets = [], frames = new Map();
let browser, host, guest;
const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
const state = page => page.evaluate(() => window.flashVersus.getState());

async function until(predicate, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(label);
}

function observe(page, name) {
  page.on('pageerror', error => errors.push(name + ': ' + error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(name + ': ' + message.text()); });
  page.on('websocket', socket => {
    sockets.push({client:name, url:socket.url()});
    socket.on('framereceived', event => {
      try {
        const packet = JSON.parse(String(event.payload));
        if (packet.type === 'frame') frames.set(name, packet.frame);
      } catch {}
    });
  });
}

async function ready(page) {
  const response = await page.goto(gameUrl, {waitUntil:'domcontentloaded', timeout:90000});
  check(response?.ok(), 'Published game returns HTTP success');
  await page.waitForFunction(() => window.flashVersus && !document.querySelector('#loading-state').checkVisibility(), null, {timeout:90000});
}

async function connectPage(page) {
  await page.bringToFront();
  await page.locator('[data-mode="multiplayer"]').click();
  check(await page.locator('[data-multiplayer="online"]').isEnabled(), 'Published game enables online play');
  await page.locator('[data-multiplayer="online"]').click();
}

async function waitBoth(predicate, arg) {
  await Promise.all([host,guest].map(page => page.waitForFunction(predicate, arg)));
}

async function leaveOwnBattle(page) {
  await page.bringToFront();
  const current = await state(page);
  if (current.menu.screen === 'battle') {
    if (current.phase === 'matchOver') await page.locator('#result-home-button').click();
    else {
      await page.locator('#pause-button').click();
      await page.locator('#home-button').click();
    }
  } else await page.locator('#brand-button').click();
  await page.waitForFunction(() => window.flashVersus.getState().menu.screen === 'mode');
}

async function saveResult(passed, error) {
  await writeFile(path.join(artifacts, 'live-results.json'), JSON.stringify({
    passed, ...(error ? {error:error.message} : {}), gameUrl:publicUrl(gameUrl),
    expectedBackend:expectedBackend ? publicUrl(expectedBackend) : null,
    checks, errors, sockets:sockets.map(socket => ({...socket,url:publicUrl(socket.url)})),
    durationMs:Date.now()-started,
  }, null, 2));
}

try {
  await mkdir(artifacts, {recursive:true});
  browser = await playwright.chromium.launch({headless:true, channel:'msedge'});
  const hostContext = await browser.newContext({viewport:{width:1440,height:900}});
  const guestContext = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  for (const context of [hostContext,guestContext]) {
    context.setDefaultTimeout(8000);
    context.setDefaultNavigationTimeout(90000);
  }
  host = await hostContext.newPage(); guest = await guestContext.newPage();
  observe(host,'host'); observe(guest,'guest');
  await Promise.all([ready(host),ready(guest)]);
  check((await state(host)).menu.screen === 'mode' && (await state(guest)).menu.screen === 'mode', 'Fresh desktop and mobile contexts load the published game');

  await connectPage(host); await host.locator('#create-room').click();
  await host.waitForFunction(() => Boolean(window.flashVersus.getState().online.code), null, {timeout:90000});
  const code = (await state(host)).online.code;
  check(/^[A-Z2-9]{6}$/.test(code), 'Live backend creates a six-character private room');
  await connectPage(guest); await guest.locator('#room-code-input').fill(code); await guest.locator('#join-room').click();
  await waitBoth(() => window.flashVersus.getState().menu.screen === 'characters');
  const initialHost = await state(host), initialGuest = await state(guest);
  check(initialHost.online.code === code && initialGuest.online.code === code && initialHost.online.seat === 0 && initialGuest.online.seat === 1, 'Two independent devices join the same live room in different seats');

  await host.bringToFront(); await host.locator('[data-fighter="cross"]').click();
  await guest.bringToFront(); await guest.locator('[data-fighter="emerald"]').click();
  await waitBoth(() => window.flashVersus.getState().menu.screen === 'stage');
  check(await guest.locator('[data-stage="paper"]').isDisabled(), 'Guest cannot change the live host stage');
  await host.bringToFront(); await host.locator('[data-stage="paper"]').click();
  await waitBoth(() => window.flashVersus.getState().phase === 'fighting');
  const roster = (await state(host)).players.map(player => player.id);
  check(JSON.stringify(roster) === JSON.stringify(['cross','emerald']) && JSON.stringify(roster) === JSON.stringify((await state(guest)).players.map(player => player.id)), 'Both devices enter the same selected live fight');

  const positions = (await state(host)).players.map(player => player.x);
  await host.keyboard.down('d'); await host.waitForTimeout(300); await host.keyboard.up('d');
  await waitBoth(x => window.flashVersus.getState().players[0].x > x, positions[0]);
  await until(() => frames.get('host')?.players[0].x > positions[0] && frames.get('guest')?.players[0].x > positions[0], 'Both sockets must receive host movement from the backend');
  check(true, 'Host keyboard movement reaches both live clients and server frames');
  await guest.bringToFront(); await guest.keyboard.down('a'); await guest.waitForTimeout(300); await guest.keyboard.up('a');
  await waitBoth(x => window.flashVersus.getState().players[1].x < x, positions[1]);
  await until(() => frames.get('host')?.players[1].x < positions[1] && frames.get('guest')?.players[1].x < positions[1], 'Both sockets must receive guest movement from the backend');
  check(true, 'Guest keyboard movement reaches both live clients and server frames');

  await host.bringToFront(); await host.keyboard.down('d');
  await host.waitForFunction(() => { const p=window.flashVersus.getState().players; return Math.abs(p[1].x-p[0].x) < 95; });
  await host.keyboard.up('d');
  const beforeHp = (await state(host)).players[1].hp;
  await host.keyboard.press('j');
  await waitBoth(hp => window.flashVersus.getState().players[1].hp < hp, beforeHp);
  const health = (await state(host)).players[1].hp;
  await waitBoth(hp => window.flashVersus.getState().players[1].hp === hp, health);
  await until(() => frames.get('host')?.players[1].hp === health && frames.get('guest')?.players[1].hp === health, 'Both live sockets must report identical authoritative damage');
  check(health < beforeHp, 'A real attack reduces identical health in both clients and backend frames');
  await host.screenshot({path:path.join(artifacts,'live-fight-desktop.png')});
  await guest.bringToFront(); await guest.screenshot({path:path.join(artifacts,'live-fight-mobile.png')});

  const socketsBeforeReload = sockets.filter(socket => socket.client === 'guest').length;
  await guest.reload({waitUntil:'domcontentloaded'});
  await guest.waitForFunction(() => window.flashVersus?.getState().online.status === 'connected' && window.flashVersus.getState().online.phase === 'battle', null, {timeout:15000});
  await host.waitForFunction(() => !window.flashVersus.getState().paused);
  const resumed = await state(guest);
  check(resumed.online.code === code && resumed.online.seat === 1 && resumed.players[1].hp === health, 'Published guest reload restores the same live room, seat and health');
  check(sockets.filter(socket => socket.client === 'guest').length > socketsBeforeReload, 'Reload opens a fresh real WebSocket connection');
  check(sockets.every(socket => new URL(socket.url).protocol === 'wss:'), 'All live connections use secure WebSockets');
  if (expectedBackend) check(sockets.every(socket => socket.url === expectedBackend), 'Every connection uses the configured production backend');
  console.log('Live private room, movement, shared damage and reload recovery passed.');

  await leaveOwnBattle(guest);
  await host.waitForFunction(() => window.flashVersus.getState().online.phase === 'waiting');
  await leaveOwnBattle(host);
  await connectPage(host); await host.locator('#find-random-match').click();
  await host.waitForFunction(() => window.flashVersus.getState().online.matchmaking?.state === 'waiting');
  await connectPage(guest); await guest.locator('#find-random-match').click();
  await waitBoth(() => window.flashVersus.getState().menu.screen === 'characters');
  const randomHost = await state(host), randomGuest = await state(guest);
  check(randomHost.online.kind === 'random' && randomGuest.online.kind === 'random' && randomHost.online.code === randomGuest.online.code && randomHost.online.seat !== randomGuest.online.seat, 'Two live random searches pair into the same room with separate seats');
  await leaveOwnBattle(host); await leaveOwnBattle(guest);
  check((await state(host)).online.code === null && (await state(guest)).online.code === null, 'Verification leaves its own live rooms cleanly');
  check(errors.length === 0, 'No browser runtime or console errors: ' + errors.join('; '));
  await saveResult(true);
  console.log('Live deployment checks passed: ' + checks.length + '. Results: artifacts/live-results.json');
} catch (error) {
  await mkdir(artifacts, {recursive:true});
  for (const [page,name] of [[host,'host'],[guest,'guest']]) {
    if (page && !page.isClosed()) await page.screenshot({path:path.join(artifacts,'live-failure-'+name+'.png')}).catch(() => {});
  }
  await saveResult(false, error);
  throw error;
} finally {
  if (browser) await browser.close();
}
