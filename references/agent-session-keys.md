# Agent Keys that follow agent sessions

On the stock layer the ChatGPT app lights the six Agent Keys with Codex thread state. For Claude, [freemicro](https://github.com/eliBenven/freemicro) does the same from Claude Code's hooks. The Claude profile pairs it with Input: Input owns the keys and layers, freemicro owns the Agent Key lights and answers `freemicro focus N`.

## What is needed

Upstream freemicro focuses **terminal tabs** only, so a Claude desktop session is a no-op there. The [`claude-desktop-focus` branch](https://github.com/buddyh/freemicro/tree/claude-desktop-focus) adds:

- desktop sessions recorded with their app session ID (`CLAUDE_CODE_HOST_SESSION_ID`);
- one Agent Key per desktop session, since the app keeps many sessions in one folder;
- focusing a desktop session through `claude://claude.ai/epitaxy/local_<uuid>`;
- `freemicro focus N`, for a Smart Action to call.

## Setup

```bash
git clone -b claude-desktop-focus https://github.com/buddyh/freemicro
pipx install --editable "./freemicro[all]"   # add --backend pip if pipx rejects your uv
freemicro install          # Claude Code hooks; back up ~/.claude/settings.json first
freemicro lights --enable
freemicro daemon install   # LaunchAgent; grant Input Monitoring when asked
```

Make freemicro lights-only, so it never acts on a key press itself (Layer 1 presses belong to Codex): in `~/.freemicro/keymap.json`, set every entry under `bindings` to `{"action": "none"}` and set `"terminal_app": false`.

Generate the Claude layer with the path from `command -v freemicro`; the generator resolves `{{freemicro}}` in the Smart Action commands.

## Behaviour

- A session takes the next free key when it first reports and keeps it while it is live; a quiet session frees its key.
- Colours: blue working, amber waiting on you, green done (fades after a few minutes), red error, dark empty.
- `freemicro keys --list` shows which session is on which key.
- Pressing a dark key does nothing (the Smart Action exits non-zero).

## Known limits

- The ChatGPT app also paints the Agent Key LEDs while it runs; the last writer wins. `agent_keys.keys` in the freemicro keymap can split the six keys between the two.
- On firmware 0.6.x `freemicro doctor` reports a failing `device.status` round trip even though lights and focus work.
- The lights follow Claude sessions on every layer, so on a non-Claude layer (for example T3 Code) they do not match what the keys do.
