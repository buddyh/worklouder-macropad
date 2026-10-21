# Work Louder Codex Micro: agent skill and configurator

An agent skill (`SKILL.md`) plus a dependency-free Node CLI for configuring the Work Louder Codex Micro through the data the macOS Input app already keeps: keys, layers, Actions, Multi Actions, Smart Actions, encoder, joystick, lighting and app-linked layers. Every change is a dry run first, then backed up, written with exact readback, and rolled back on failure. Layer 1, the stock Codex layer, is protected.

## Agent app layers

Ready-made layers that switch on by themselves when the app is frontmost:

| Profile | App | Agent Keys |
|---|---|---|
| `profiles/claude-desktop.json` | Claude desktop (Code tab) | One key per Claude session, lit by state and opened on press, via [freemicro](references/agent-session-keys.md) |
| `profiles/t3-code.json` | T3 Code | Sidebar threads 1-6 |

```bash
node scripts/worklouder.js inspect                      # what is on the pad now
node scripts/generate-app-layer.js --profile profiles/claude-desktop.json --layer 3 \
  --mic KC_LSFT,KC_LALT --output layer3.json            # --mic is optional: your dictation shortcut
node scripts/worklouder.js apply-config layer3.json     # dry run
osascript -e 'quit app "input"'
node scripts/worklouder.js apply-config layer3.json --apply
open -a input
```

Details: [references/agent-apps.md](references/agent-apps.md).

## Requirements

- macOS, Node 22+, Work Louder Input.
- Verified on Input 0.17.2 with firmware v0.5.0-rc.1, and Input 1.0.2 with firmware 0.6.3. See [references/firmware.md](references/firmware.md).

## Using it with an agent

Point Claude Code or Codex at `SKILL.md`. It covers the safety rules, the workflow and the references an agent needs.

## License

MIT. Not affiliated with Work Louder or OpenAI; "Codex Micro" and "Input" are their respective owners' names, used to describe compatibility.
