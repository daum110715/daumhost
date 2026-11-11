# 用法

[English](usage.md) | 中文

怎么用 daumhost 跑任务。安装和设备设置见 [README](../README.zh-CN.md)，全部选项见 [cli.zh-CN.md](cli.zh-CN.md)。

## 看设备

```sh
daumhost status            # 在线否、在跑几个、有哪些工作区和预设任务
```

## 跑任意脚本：common/node

入口叫 `main.mjs`，写进 `out/` 的文件会取回（`out/` 由脚本自己建）。

```sh
daumhost run --src <目录> --out <目录> common/node [参数…]
```

- `--src` 下的全部文件都上传，上限 48 MB；取回上限 128 MB
- 用设备上的 Windows Node 运行，工作目录就是任务目录，任务结束即删除
- 最多 4 个同时跑，每个限时 1 小时，每个参数不超过 400 字符
- 选项写在 `common/node` 之前，之后的全部内容都当参数
- 中断命令即取消任务；命令输出日志的最后 20 行、取回文件的路径和耗时

## 用浏览器

把 `kit/chrome.mjs` 复制到 `main.mjs` 旁边：

```js
import { launch } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('out', { recursive: true });
const b = await launch();                       // 无头 Chrome，没有则用 Edge
await b.send('Page.enable');
await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await b.send('Page.navigate', { url: 'https://example.com/' });
const title = await b.evaluate('document.title'); // 可以返回 Promise
const shot = await b.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('out/page.png', Buffer.from(shot.data, 'base64'));
await b.close();                                // 结束浏览器并删除临时配置
```

- `b.send(方法, 参数)` 发任意 CDP 命令，`b.on(事件, fn)` 监听事件
- `launch({ mouse, webgl })`：`mouse` 默认 `true`，按鼠标设备上报；模拟手机传 `false` 并发 `Emulation.setTouchEmulationEnabled`。`webgl` 默认 `true`（SwiftShader），用不到传 `false` 更快。环境变量 `CHROME_GPU=1` 用显卡
- 整页长图：`captureScreenshot` 带 `clip` 和 `captureBeyondViewport: true`
- 页面加载后等 `document.fonts.ready` 再截图
- 多个场景各开一个 `launch()`，用 `Promise.all` 并行

## 预设任务

```sh
daumhost presets [<工作区>]                                # 有哪些 接受什么参数
daumhost run [--src <目录>] [--out <目录>] <工作区>/<预设> [参数…]
```

## Shell

```sh
daumhost sh --workspace <名称> [--cwd <子目录>] [--timeout <秒>] <命令…>
```

用 PowerShell 执行。不在白名单里的命令要等设备主人批准，最长 5 分钟。命令里不要写密钥。

## 工作区和文件夹

```sh
daumhost ls [<路径>]                         # 不带路径列磁盘
daumhost ws add <名称> <路径> [--create]
```

工作区以外的操作要设备主人批准。路径写成 `F:/a/b`。

## 结果

- `--json`：只输出一个 JSON 对象，`run` 和 `sh` 的字段有 `ok` `exitCode` `outDir` `files` `log` `error`
- 退出码：`0` 成功；任务失败时为任务自己的退出码；`1` 没能运行（参数不被接受、审批被拒或超时）；`2` 用法错误；`3` 连不上设备、已暂停或队列已满
