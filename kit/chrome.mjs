// Headless Chrome (or Edge) over CDP for a job on daumhost, with a profile deleted on exit. Any project
// copies this next to its script for common/node. CHROME: the browser, when not in its usual place.
// CHROME_PROFILES: where the throwaway profiles go (common/node sets it, off C:). CHROME_GPU=1: draw with the GPU.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { constants, getPriority, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!chrome) throw new Error('no Chrome or Edge found: set CHROME');
const profiles = process.env.CHROME_PROFILES ?? join(tmpdir(), 'chrome-profiles');
const gpu = process.env.CHROME_GPU === '1';
const win = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ends a Chrome and every process it started. Killing the browser process alone can leave its GPU and
// renderer processes running on their own, still drawing with background throttling off: on a page that
// animates, a whole core or more each, until the machine stops responding.
function killTree(pid) {
  if (!pid) return;
  if (win) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {}
  }
}

// Chromes this run started and has not closed, ended however the run ends: close() never called, an
// error, process.exit(). (When daumhost cancels the run it ends the whole tree itself, and they all end
// with daumhost.)
const running = new Set();
process.on('exit', () => {
  for (const pid of running) killTree(pid);
});

// A Chrome left running by an earlier run that ended without closing it, which keeps its profile in use.
function killProfileUsers(dir) {
  if (!win) return;
  const like = dir.replace(/'/g, "''");
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${like}*' } | ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }`,
  ], { windowsHide: true, stdio: 'ignore', timeout: 30000 });
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// profiles a finished run could not delete, cleared once the run that made them is gone; one still in use
// belongs to a Chrome that outlived its run, which is ended first
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
    const dir = join(profiles, name);
    const remove = () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    };
    remove();
    if (!existsSync(dir)) continue;
    killProfileUsers(dir);
    remove();
  }
}

export async function launch({ mouse = true, webgl = true } = {}) {
  sweep();
  const prof = join(profiles, `chrome-${process.pid}-${Date.now() % 100000}`);
  const port = 9100 + Math.floor(Math.random() * 700);
  // Chrome's own temporary files go in the profile too, never in /tmp
  mkdirSync(prof, { recursive: true });
  // Below normal priority, which Windows passes on to every process Chrome starts: a page that draws
  // nonstop then takes only the time the owner's programs leave over, and the machine stays usable.
  const priority = getPriority();
  try {
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
  const proc = spawn(
    chrome,
    [
      '--headless=new', '--no-sandbox', '--hide-scrollbars', '--lang=zh-CN', '--mute-audio',
      // Started from an elevated daumhost, Chrome otherwise relaunches itself unelevated and the process
      // spawned here exits at once: the browser is then no child of this run, and killing proc ends nothing
      '--do-not-de-elevate',
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
      // its own process group elsewhere, so killTree reaches its children
      detached: !win,
    },
  );
  try {
    setPriority(priority);
  } catch {}
  running.add(proc.pid);
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(150);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) {
    running.delete(proc.pid);
    killTree(proc.pid);
    throw new Error('chrome did not start');
  }
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
    running.delete(proc.pid);
    killTree(proc.pid);
    await sleep(300);
    // (Windows keeps a dying Chrome's files locked for a moment, now and then for longer: then
    // the profile is left for a later run to clear, and what this run made still stands)
    try {
      rmSync(prof, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {}
  };
  return { send, on, evaluate, close };
}
