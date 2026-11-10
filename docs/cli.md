# Command-line manual

English | [中文](cli.zh-CN.md)

`daumhost` is the command-line tool on the server. It submits jobs to the device and manages the device's workspaces. Its short name is `daumhost`. For the terms used here (server, device, workspace, preset) and for setting up the device, see the [README](../README.md).

## Installation

The server needs Node.js 18 or later and a checkout of this repository. Run this in the checkout:

```sh
npm link
```

This installs the commands `daumhost`, `daumhost` and `daumhost` into npm's global `bin` folder; that folder must be on `PATH`. The commands keep pointing at the checkout, so `git pull` updates them too. Without `npm link`, run `node /path/to/daumhost/cli.mjs` instead; it behaves the same.

## Commands

| Command | Short form | Purpose |
|---|---|---|
| `status` | `st` | Whether the device is reached, the jobs running and waiting, and the workspaces. |
| `presets` | | The workspaces' presets and the arguments they take. |
| `run` | | Run a preset and fetch the files it makes. |
| `shell` | `sh` | Run a command in a workspace. |
| `workspace` | `ws` | List the workspaces, or add, change or remove one. |
| `ls` | | List a folder on the device, or its drives. |
| `clip` | | Read what was copied on the device, or put something on its clipboard. |
| `power` | | Turn the device's screen off, or let it hibernate once the work is done. |
| `help` | | Show what the commands do. |

## Common rules

- `--json`: print one JSON object, the result, to standard output, and nothing else. Every command takes it.
- `-h` and `--help`: show the command's help. `daumhost help <command>` does the same.
- Option placement: for `run` and `shell`, options come before the preset or the command, because what follows is passed on as arguments or as the command. Other commands take options anywhere. `--` ends the options.
- Progress messages, such as a job's place in the queue or a wait for approval, go to standard error and are left out with `--json`.
- The device is reached through the tunnel on ports 7700–7709 of the server. The command tries them in turn and uses the first one where daumhost answers. Set `DAUMHOST_PORT` to use only that port.
- Paths on the device are full paths. Write them with forward slashes, as in `F:/projects/site`, or quote them when they use backslashes: `'F:\projects\site'`.

## status

```sh
daumhost status [--json]
```

Shows whether the device is reached, how many jobs run and wait there and how many may run at once, whether it is paused, the Shell mode, whether the server may manage workspaces, and each workspace with its presets and the settings it still lacks.

`--json` prints:

| Field | Description |
|---|---|
| `online` | Whether the device was reached. |
| `port` | The port it was reached on. |
| `protocol`, `features` | The protocol version and the features daumhost supports (see "Compatibility"). |
| `platform` | The device's operating system, such as `win32`. |
| `accepting` | `false` while daumhost is paused. |
| `limit` | How many jobs may run at once. |
| `running` | The jobs running, each with `id`, `kind` and its preset or command. |
| `queued` | How many jobs wait. |
| `shell` | The Shell mode: `disabled`, `auto` or `yolo`. |
| `manage` | Whether the server may manage workspaces: `off`, `ask` or `allow`. |
| `workspaces` | Each workspace's `name`, `path`, `missing` (settings not yet filled in), `parallel` and `presets`, and `error` if its workspace file is invalid. |

## presets

```sh
daumhost presets [<workspace>] [--json]
```

Lists the presets of every workspace, or of one workspace. For each preset it shows the description, the arguments it accepts (each argument must match one of the listed patterns in full), the files a job brings from the server, and the time limit.

`--json` prints `ok` and `presets`, a list in which each preset has `workspace`, `name`, `description`, `args`, `upload` and, if it has one, `timeout`.

## run

```sh
daumhost run [--src <dir>] [--out <dir>] [--json] <workspace>/<preset> [args…]
```

Runs a preset on the device and waits for it to end.

- Everything after `<workspace>/<preset>` is passed to the preset as arguments. The device refuses arguments the preset does not accept.
- `--src`: the folder in which the preset's `upload` globs are matched; defaults to the current folder. The files brought may total at most 48 MB.
- `--out`: where the returned files are saved; defaults to `.tools/results/<time>/` in daumhost checkout. Returned files may total at most 128 MB.
- When the device already runs as many jobs as it allows, the job waits in the queue and the command reports how many jobs are ahead. Interrupting the command, or losing the connection, cancels the job, whether it is waiting or running.
- The command prints the last 20 lines of the job's output, the paths of the returned files and the elapsed time.

```sh
cd ~/site
daumhost run site/build 1080p
```

`--json` prints:

| Field | Description |
|---|---|
| `ok` | Whether the job succeeded. |
| `exitCode` | The job's exit code; `null` if it did not run. |
| `kind` | `"preset"`. |
| `workspace`, `preset`, `args` | What was run. |
| `port`, `seconds` | The port used and the elapsed time. |
| `outDir`, `files` | The folder of the returned files and each file's path. |
| `log` | The job's output (the last 256 KiB). |
| `error` | Why the job failed; `null` on success. |

## shell

```sh
daumhost shell [--workspace <name>] [--cwd <dir>] [--timeout <s>] [--json] <command…>
```

Runs a command on the device and prints its whole output and its exit code. The device's owner must have enabled Shell; see "Shell permissions" in the README.

- `--workspace`: the workspace to run in; defaults to the first one registered.
- `--cwd`: a folder within the workspace, relative to its root; defaults to the root.
- `--timeout`: time limit in seconds; default 600, maximum 7200.
- On Windows the command runs in a non-interactive PowerShell that loads no profile. It gets the workspace's settings as environment variables. No files are brought along.
- The output is always UTF-8. When the command ends with a non-zero exit code, the job ends with it too; when the last command fails without one (a PowerShell command's error, for example), the exit code is 1.
- A command not on the device's allowlist waits up to 5 minutes for the owner's approval; the command then reports that it is waiting.
- Commands are shown in the approval dialog and written to the device's log. Never put keys or passwords in them.

```sh
daumhost sh --workspace site git status
daumhost sh --workspace site --cwd assets --timeout 60 'Get-ChildItem -Recurse | Measure-Object'
```

`--json` prints the same fields as `run`, with `kind` set to `"shell"` and `command` in place of `preset` and `args`.

## workspace

```sh
daumhost workspace [list] [--json]
daumhost workspace add <name> <path> [--create] [--env NAME=value …] [--json]
daumhost workspace set <name> [--path <path> [--create]] [--env NAME=value …] [--unset NAME …] [--json]
daumhost workspace remove <name> [--json]
```

Without an action, or with `list`, lists the workspaces as `status` does. The other actions change them:

- `add` registers a folder as a workspace. When the folder holds an old daumhost's `.tools/remote/config.json`, the settings there that the workspace file declares are imported.
- `set` changes a workspace's path or settings. `--env NAME=` (an empty value) clears a setting, as `--unset NAME` does.
- `remove` unregisters a workspace. Its folder is left as it is.
- `--create`: make the folder if it does not exist yet. Without it, a missing folder is an error.
- `--env` and `--unset` may be given more than once.

Whether a change needs approval depends on the device's setting 服务器管理工作区 (Server manages workspaces); see "Approvals".

```sh
daumhost ws add site F:/projects/site
daumhost ws add scratch F:/scratch --create
daumhost ws set site --env FFMPEG=C:/ffmpeg/bin/ffmpeg.exe
daumhost ws remove scratch
```

Settings are shown in the approval dialog and written to the device's log. Never pass keys or passwords with `--env`.

`--json` prints `ok`, `action`, `workspace` (its `name`, `path`, `missing` and `presets` after the change; `null` after a removal), `imported` (the names of the settings imported), `created` (the folder made, or `null`) and, on failure, `error`. `list --json` prints `ok` and `workspaces`, as in `status --json`.

## ls

```sh
daumhost ls [<path>] [--json]
```

Lists a folder on the device: the name, size and time of last change of each file and folder in it. File contents are never read. Without a path, it lists the device's drives.

- Folders come first, then files, each in name order. At most 1000 entries are shown; the rest are counted.
- Folders inside a registered workspace are listed without approval. Other folders depend on 服务器管理工作区; see "Approvals".

```sh
daumhost ls
daumhost ls F:/
daumhost ls 'F:\projects'
```

`--json` prints `ok`, `path` (the folder in full; `null` for the drive list), `entries` (each with `name`, `type` (`"folder"` or `"file"`), `size` in bytes (`null` for folders) and `modified` in milliseconds since 1970) and `more` (how many entries were left out).

## clip

```sh
daumhost clip [--json]
daumhost clip ls [--json]
daumhost clip set [<text…>] [--file <path>] [--json]
```

While the device has 同步剪贴板 (Sync clipboard) on, text and pictures copied there are written to `~/.daumhost/clipboard/` on the server by themselves; see "Clipboard sync" in the README. `daumhost clip` and `xclip` look in that account's home and in `$HOME`, when it differs, and read what came last.

- `daumhost clip`: prints the newest. Text as it is; for a picture, the path of its PNG.
- `daumhost clip ls`: lists the last 50, newest first, with the time, type, size, path and the start of the text.
- These two read the files on the server and do not need the device.
- `daumhost clip set`: puts something on the device's clipboard: the text after the command, the file `--file` names, or standard input. A PNG, JPEG, GIF, BMP or TIFF goes there as a picture, anything else as UTF-8 text; up to 20 MB. Text that starts with `--` goes after `--`. What is put there is not sent back.

```sh
daumhost clip
daumhost clip ls
git diff | daumhost clip set
daumhost clip set --file shot.png
```

### As xclip

Programs on the server read and write the clipboard with `xclip` (Claude Code, for one, when pasting a picture). Link `daumhost` as `xclip` in a folder early on the PATH:

```sh
ln -s "$(command -v daumhost)" ~/.local/bin/xclip
```

Then what they read is what was last copied on the device (as `daumhost clip` gives it), and what they write goes onto the device's clipboard as with `daumhost clip set`. So a picture copied on the device is pasted into Claude Code on the server. Claude Code on Linux pastes a picture with Ctrl+V, which a Windows terminal keeps for pasting text; bind Alt+V to it as well in `~/.claude/keybindings.json` on the server: `{"bindings": [{"context": "Chat", "bindings": {"alt+v": "chat:imagePaste"}}]}`. It takes xclip's `-selection`, `-target` (`TARGETS` too), `-out`, `-in`, `-filter` and `-rmlastnl`, and their abbreviations. Do not do this on a machine with a desktop of its own: it would hide the real xclip.

With `--json`, `daumhost clip` prints `ok`, `path`, `type` (`"text"` or `"image"`), `size` in bytes and `at` in milliseconds since 1970, and `text` for text; `daumhost clip ls` prints `ok` and `entries`, each with the same fields but `text`; `daumhost clip set` prints `ok`, `type` and `size`.

## power

```sh
daumhost power screen-off [--json]
daumhost power hibernate [--json]
```

- `screen-off`: turns the device's screen off at once. The jobs go on: while daumhost takes jobs, the device does not go to sleep on its own (see "State and logs" in the README). Moving the mouse or pressing a key turns the screen on again.
- `hibernate`: for when the server's work is done. The device hibernates 5 seconds after the reply, and is out of reach until someone wakes it; daumhost then connects again by itself. A job that comes in during those 5 seconds keeps it up.
- Neither on someone using the device: `screen-off` is refused when a key or the mouse was used there in the last minute, `hibernate` in the last 5 minutes, and `hibernate` also while jobs run or wait there or a request awaits the owner's approval. A refusal exits with 1 and says why.

```sh
daumhost power screen-off
daumhost power hibernate
```

With `--json`, both print `ok`, `action` and `idle` (the seconds since the last key or mouse movement on the device); `hibernate` also `in`, the seconds until it hibernates.

## help

```sh
daumhost help [<command>]
```

Shows the list of commands, or what one command does, its options and examples.

## Approvals

The device's setting 服务器管理工作区 (Server manages workspaces) decides what `workspace` and `ls` may do:

| Setting | `workspace` add, set, remove | `ls` |
|---|---|---|
| 关闭 (Off) | Refused. | Refused. |
| 需要审批 (Ask, the default) | Each change waits for approval. | Folders in a registered workspace: listed at once. Others: each request waits for approval. |
| 无需审批 (Allow) | Made at once. | Listed at once. |

- A request waiting for approval appears as a dialog in the device's window, and the tray icon shows a notification that opens the window when clicked. The command reports `waiting for the owner's approval on the device` and waits up to 5 minutes. A denial, a timeout or an interrupted command means the request has no effect.
- When the owner approves listing a folder, that folder and everything under it can be listed again for 10 minutes without another approval. Approving the drive list covers the drive list only. Changing the setting, pausing daumhost or reconnecting closes these windows.
- Requests and the folders listed outside workspaces appear on the device's Activity page and in its log.

## Exit status

| Exit status | Meaning |
|---|---|
| 0 | Done. |
| The job's own | A job ran and failed. |
| 1 | The request failed without running: an argument the preset does not accept, a denied or expired approval, a refused workspace change, a folder that cannot be listed, a refused `power`, a daumhost too old for the command. |
| 2 | The command was used incorrectly. |
| 3 | The device was not reached, daumhost is paused, or too many jobs already wait. |

A job's own exit status can coincide with 1, 2 or 3. When the difference matters, use `exitCode` in the `--json` output.

## Compatibility

The command and daumhost on the device must speak the same protocol version; otherwise every command reports `protocol mismatch`. Within a version, daumhost lists its features in `status --json`. A command that needs a feature the device lacks, such as `ls` or `--create`, reports that daumhost is too old; it updates itself, or the owner can click 立即检查 (Check now) in its Settings → Updates and about page.

## Typical tasks

Register a project folder on the device and see what it offers:

```sh
daumhost ls                     # the drives
daumhost ls F:/                 # needs one approval; folders under F:/ are then open for 10 minutes
daumhost ls F:/projects
daumhost ws add site F:/projects/site
daumhost presets site
```

Run a preset from a script and read its result:

```sh
daumhost run --json --src ~/site site/build 1080p > result.json
```

Check that the device is ready before submitting:

```sh
daumhost status --json | jq '.online and .accepting'
```
