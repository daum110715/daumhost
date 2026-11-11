# Usage

English | [中文](usage.zh-CN.md)

How to run jobs with daumhost. Installation and device setup: [README](../README.md). Every option: [cli.md](cli.md).

## Check the device

```sh
daumhost status            # online, jobs running, workspaces and presets
```

## Run any script: common/node

The entry is `main.mjs`; files written to `out/` come back (the script creates `out/`).

```sh
daumhost run --src <dir> --out <dir> common/node [args…]
```

- Everything under `--src` is uploaded, up to 48 MB; up to 128 MB comes back
- Runs on the device's Windows Node, in the job folder, which is deleted afterwards
- Up to 4 at once, 1 hour each, each argument at most 400 characters
- Options go before `common/node`; everything after it is passed as arguments
- Interrupting the command cancels the job; it prints the last 20 log lines, the returned paths and the time taken

## Use a browser

Copy `kit/chrome.mjs` next to `main.mjs`:

```js
import { launch } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('out', { recursive: true });
const b = await launch();                       // headless Chrome, else Edge
await b.send('Page.enable');
await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await b.send('Page.navigate', { url: 'https://example.com/' });
const title = await b.evaluate('document.title'); // may return a Promise
const shot = await b.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('out/page.png', Buffer.from(shot.data, 'base64'));
await b.close();                                // ends the browser, deletes its profile
```

- `b.send(method, params)` sends any CDP command; `b.on(event, fn)` listens
- `launch({ mouse, webgl })`: `mouse` defaults to `true` and reports a mouse; for a phone pass `false` and send `Emulation.setTouchEmulationEnabled`. `webgl` defaults to `true` (SwiftShader); pass `false` when unused, it is quicker. `CHROME_GPU=1` draws with the GPU
- Full-page image: `captureScreenshot` with `clip` and `captureBeyondViewport: true`
- After loading, wait for `document.fonts.ready` before a screenshot
- One `launch()` per scenario, run in parallel with `Promise.all`

## Presets

```sh
daumhost presets [<workspace>]                                 # what exists, what arguments
daumhost run [--src <dir>] [--out <dir>] <workspace>/<preset> [args…]
```

## Shell

```sh
daumhost sh --workspace <name> [--cwd <subdir>] [--timeout <s>] <command…>
```

Runs in PowerShell. A command not on the allow list waits for the owner's approval, up to 5 minutes. Never put secrets in a command.

## Workspaces and folders

```sh
daumhost ls [<path>]                         # no path lists the drives
daumhost ws add <name> <path> [--create]
```

Anything outside the workspaces waits for the owner's approval. Write paths as `F:/a/b`.

## Results

- `--json`: prints one JSON object; for `run` and `sh` the fields include `ok` `exitCode` `outDir` `files` `log` `error`
- Exit status: `0` done; the job's own status when it ran and failed; `1` it could not run (argument refused, approval refused or timed out); `2` usage error; `3` device not reached, paused or queue full
