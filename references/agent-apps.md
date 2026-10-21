# Agent app layers

A layer per agent app, switched automatically by Input's AppSense when that app is frontmost. Two profiles ship in `profiles/`: the Claude desktop app and T3 Code. Each is a portable description; `scripts/generate-app-layer.js` turns it into a manifest with IDs allocated from the user's own Input database.

## How a layer follows the app

- A `linkedApps` entry names the app by **bundle identifier** in `process` (for example `com.anthropic.claudefordesktop`).
- The layer's `linkedAppId` points at that entry.
- Input watches focus and sends `host.focused_app` to the pad; the firmware selects the linked layer. Input must be running for this to work.
- `device.status.layer_index` is zero-based: `2` is Layer 3.

Find a bundle identifier with:

```bash
osascript -e 'id of app "Claude"'
mdfind "kMDItemCFBundleIdentifier == 'com.t3tools.t3code'"
```

## Choosing what each key sends

Map every key to something the target app actually does with that input. Terminal habits do not carry over: Shift+Tab cycles the permission mode in the Claude Code CLI but does nothing in the desktop app.

Where to find an app's real shortcuts:

| App | Source |
|---|---|
| Claude desktop | The in-app Keyboard Shortcuts panel (Cmd+/) is the full list. Menu accelerators alone miss most of them. |
| T3 Code | Defaults are compiled into the app; user overrides live in `~/.t3/userdata/keybindings.json` as `{"key": "mod+shift+a", "command": "composer.mode"}`. |
| Any Electron app | `accelerator:"..."` strings inside `Contents/Resources/app.asar` list menu shortcuts only. |

Multi-key shortcuts become Input Actions: modifiers pressed, the key clicked, modifiers released in reverse order. Profiles describe these as `{"chord": ["KC_LALT", "KC_LGUI", "KC_F"]}` and the generator builds the Action.

## Claude desktop app (`profiles/claude-desktop.json`)

| Key | Sends | Claude desktop meaning |
|---|---|---|
| Agent Keys 1-6 | Smart Action `freemicro focus N` | Open the session lit on that key (see `agent-session-keys.md`) |
| FAST | Option-Command-F | Toggle fast mode |
| APPR | Return | Approve / submit; confirm on your build |
| REJ | Escape | Stop Claude's response |
| SPLIT | Command-N | New session |
| CODEX | Return | Send |
| Dial | Option-Up / Option-Down | Previous / next session |

Other useful desktop shortcuts from the Cmd+/ panel: Shift-Command-M mode menu, Shift-Command-I model menu, Shift-Command-E effort, Option-Command-O fork session, Command-1...9 jump to session, Control-O transcript view, Command-Return queue while Claude is working, Command-D dictation.

Session deep link: `claude://claude.ai/epitaxy/local_<uuid>` opens an existing session. Inside a desktop session, `CLAUDE_CODE_ENTRYPOINT=claude-desktop` and `CLAUDE_CODE_HOST_SESSION_ID=local_<uuid>` are set, and Claude Code hooks inherit them. The host ID differs from `CLAUDE_CODE_SESSION_ID`; the deep link needs the host ID.

## T3 Code (`profiles/t3-code.json`)

| Key | Sends | T3 command |
|---|---|---|
| Agent Keys 1-6 | Command-1...6 | `thread.jump.1`...`6` (sidebar order) |
| FAST | Shift-Command-A | `composer.mode` |
| APPR | Return | Approve / submit; confirm on your build |
| REJ | Command-. | `thread.stop` (needs the binding below) |
| SPLIT | Shift-Command-O | `chat.new` |
| CODEX | Return | Send |
| Dial | Shift-Command-[ / ] | `thread.previous` / `thread.next` |

`thread.stop` ships unbound. Add it, after backing up the file:

```json
{"key": "mod+.", "command": "thread.stop"}
```

appended to the array in `~/.t3/userdata/keybindings.json`. Restart T3 if it was open.

Limits, as of T3 Code 0.0.46 nightly:

- No deep link, RPC or socket request focuses an **existing** thread. The `t3code://` scheme handles provider OAuth only. Agent Keys therefore follow sidebar order, not agent state.
- `mod+n` is `chat.new` but also `terminal.new` when a terminal is focused; `mod+shift+o` is unambiguous.

## Adding another app

1. Copy a profile, set `id`, `layerName`, `color` and `linkedApp`.
2. Fill `keys` (inputs `AG00`-`AG05`, `ACT06`-`ACT09`, `ACT12`) and `encoder` with `keycode`, `chord` or `command` bindings, from the app's real shortcut list.
3. Leave `ACT10`/`ACT11` (the two halves of the wide MIC key) out; the user picks them with `--mic`.
4. Generate, dry-run, apply and physically test as in SKILL.md.
