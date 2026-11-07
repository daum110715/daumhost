// Headless Chrome (or Edge) over CDP for a job on the station, with a profile deleted on exit. Any project
// copies this next to its script for common/node. CHROME: the browser, when not in its usual place.
// CHROME_PROFILES: where the throwaway profiles go (common/node sets it, off C:). CHROME_GPU=1: draw with the GPU.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!chrome) throw new Error('no Chrome or Edge found: set CHROME');
const profiles = process.env.CHROME_PROFILES ?? join(tmpdir(), 'chrome-profiles');
const gpu = process.env.CHROME_GPU === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// profiles a finished run could not delete (Windows held on to its Chrome's files past its end),
// cleared once the run that made them is gone
function sweep() {
  let names = [];
  try {
    names = readdirSync(profiles);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = Number(/^chrome-(\d+)-/.exec(name)?.[1]);
    if (!pid || pid === process.pid || alive(pid)) continue;
    try {
      rmSync(join(profiles, name), { recursive: true, force: true });
    } catch {}
  }
}

export async function launch({ mouse = true, webgl = true } = {}) {
  sweep();
  const prof = join(profiles, `chrome-${process.pid}-${Date.now() % 100000}`);
  const port = 9100 + Math.floor(Math.random() * 700);
  // Chrome's own temporary files go in the profile too, never in /tmp
  mkdirSync(prof, { recursive: true });
  const proc = spawn(
    chrome,
    [
      '--headless=new', '--no-sandbox', '--hide-scrollbars', '--lang=zh-CN', '--mute-audio',
      // WebGL through SwiftShader; without it plain software drawing is quicker
      ...(gpu ? [] : webgl ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--disable-gpu']),
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--font-render-hinting=none',
      ...(mouse ? ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] : []),
      `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, 'about:blank',
    ],
    {
      env: { ...process.env, TMPDIR: prof },
      stdio: 'ignore',
    },
  );
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(150);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, method } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`));
      else resolve(m.result);
      return;
    }
    for (const fn of listeners.get(m.method) ?? []) fn(m.params);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject, method });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const on = (method, fn) => (listeners.get(method) ?? listeners.set(method, []).get(method)).push(fn);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const close = async () => {
    try {
      ws.close();
    } catch {}
    proc.kill('SIGKILL');
    await sleep(300);
    // (Windows keeps a dying Chrome's files locked for a moment, now and then for longer: then
    // the profile is left for a later run to clear, and what this run made still stands)
    try {
      rmSync(prof, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {}
  };
  return { send, on, evaluate, close };
}
