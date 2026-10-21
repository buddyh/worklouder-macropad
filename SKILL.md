---
name: worklouder-macropad
description: Inspect, design, configure, back up, and physically verify Work Louder Codex Micro workflows through the macOS Input app. Use for keys, six layers, profiles, Actions, Multi Actions, Smart Actions, commands, app/URL/text actions, encoder controls, radial joystick sectors, lighting, linked-app layers, firmware compatibility, or diagnosing buttons that save but do not execute.
---

# Work Louder Macropad

Configure the device as an agent-assisted control surface while preserving the user's working layout. The bundled CLI edits every Codex Micro surface exposed by Input 0.17.2 with firmware v0.5.0-rc.1, and by Input 1.0.2 with firmware 0.6.3. Treat other versions as unverified until inspected and physically tested.

## Non-negotiable boundaries

- Preserve existing profiles and stock Layer 1 unless the user explicitly authorizes changing them.
- Default to read-only inspection and dry runs. `--apply` is required for device writes.
- Never flash firmware or enter the bootloader. Direct the user to Input's firmware-update UI.
- Never enable command execution without explicit user approval and `--allow-command-execution`.
- Never print Smart Action payloads by default; they can contain private commands or text.
- Back up the device files, Input cache, and Input database before mutation.
- Quit Input before direct HID reads/writes. Relaunch it before testing Smart Actions.
- Do not call a control working until a physical test produces the intended result.

## Start here

Run from this skill directory:

```bash
node scripts/enable-smart-actions.js --status
node scripts/worklouder.js inspect
```

Read only the references needed for the request:

- [capabilities.md](references/capabilities.md): every configurable surface, support status, and known unknowns.
- [configuration.md](references/configuration.md): manifest operations and complete schemas.
- [recipes.md](references/recipes.md): portable app, URL, text, command, agent, execution-context, and diagnostic-feedback patterns.
- [hardware-verification.md](references/hardware-verification.md): disposable-layer test matrix for keys, gestures, encoder, joystick, lighting, layers, and AppSense.
- [input-protocol.md](references/input-protocol.md): Input storage, HID RPC, serialization, checksums, and recovery.
- [firmware.md](references/firmware.md): firmware, Input version, Smart Actions gate, code-signing, and recovery.
- [keycodes.md](references/keycodes.md): keycode families and layer/profile switching.
- [agent-apps.md](references/agent-apps.md): per-app layers for Claude desktop and T3 Code, AppSense, finding an app's real shortcuts, adding another app.
- [agent-session-keys.md](references/agent-session-keys.md): Agent Keys lit and focused per Claude session through freemicro.

## Workflow-design process

1. Ask what the user wants faster, or inspect only the workflow sources they place in scope. Look for repeated commands, app/URL destinations, text snippets, routine agent prompts, and context-sensitive tasks.
2. Inventory the live layout. Do not duplicate stock controls or overwrite occupied keys.
3. Propose a compact layout by layer. Explain why each control earns physical space and which action type it uses.
4. Prefer the simplest native primitive:
   - keycode for keys, media controls, and firmware functions;
   - Action for ordered key events and delays;
   - Multi Action for tap, double tap, hold, and tap-then-hold;
   - Smart Action for one host command, app, URL, or text insertion;
   - linked app for automatic layer selection.
5. Use an Action when a gesture must perform a sequence. Point the Multi Action gesture at that Action. A Smart Action is one host operation, not an Input-side multi-step chain.
6. Create a version-1 JSON manifest and dry-run it:

```bash
node scripts/worklouder.js apply-config /path/to/layout.json
```

7. Review the hashes, changed-file list, references, stock-layer result, and user-visible effects. Resolve every validation error before writing.
8. Obtain explicit approval for `CMD_STEP`, Layer 1 changes, or the experimental Input app patch.
9. Quit Input, apply, and relaunch:

```bash
node scripts/worklouder.js apply-config /path/to/layout.json --apply
open -a input
```

Add `--allow-command-execution` only when the manifest enables command permission. Layer 1 changes require both an operation-level `allowStockLayer: true` and CLI-level `--allow-stock-layer`.
10. Physically verify every changed input and inspect `~/Library/Logs/input/main.log` when host actions fail.

## Agent app layers

Give each agent app its own layer that turns on when the app is frontmost. Profiles in `profiles/` describe a layer portably; the generator allocates Action, Smart Action and linked-app IDs from the user's live Input data, so no shared profile overwrites the user's own definitions.

1. Inventory: `node scripts/worklouder.js inspect`. Pick a free layer (2-6, never 1) and confirm with the user which layer it is.
2. Ask which dictation shortcut, if any, the wide MIC key should hold. Never assume one.
3. For the Claude profile, set up freemicro first ([agent-session-keys.md](references/agent-session-keys.md)). For T3 Code, add the `thread.stop` keybinding ([agent-apps.md](references/agent-apps.md)).
4. Generate and dry-run:

```bash
node scripts/generate-app-layer.js --profile profiles/claude-desktop.json --layer 3 \
  [--mic KC_LSFT,KC_LALT] --output /tmp/layer3.json
node scripts/worklouder.js apply-config /tmp/layer3.json
```

5. Check `protectedLayer1Preserved: true` and that only the intended files change. Then quit Input, apply with `--apply`, and relaunch Input (AppSense and Smart Actions need it running).
6. Read back with `inspect --live` and have the user physically test: the layer follows the app, every key, both dial directions.

Re-running the generator against an already-applied layer should dry-run to no changes; that is the check that a profile matches what is on the device.

## Smart Actions

Firmware stores a trigger such as `SA_3`; Input stores the definition and executes it on macOS. A valid definition without a mapped control is unreachable. A mapped `SA_N` without a definition is inert.

Supported types:

| Type | Payload | Behavior |
|---|---|---|
| `APP_STEP` | `name`, `path` | Open an application |
| `URL_STEP` | `url` | Open a URL |
| `TEXT_STEP` | `text` | Insert fixed text |
| `CMD_STEP` | `cmd` | Run one command through Input's Electron `child_process.exec` handler |

Input does not open a terminal. It passes the command string to Electron's `child_process.exec`, so interactive-shell assumptions are unsafe. Prefer an absolute wrapper path. When shell initialization is intentionally required, invoke it explicitly, for example `/bin/zsh -lic '<command>'`. Close stdin for non-interactive agent commands with `</dev/null`; otherwise a CLI can wait indefinitely on Input's open pipe.

Give every agent command an explicit execution context. Use `codex exec -C <workspace>` for Codex, and add `--skip-git-repo-check` only when that selected context is intentionally not a Git repository. A public layout should resolve named/default contexts from user configuration rather than embedding machine-specific paths. See [recipes.md](references/recipes.md).

Generate a portable agent Smart Action and optionally map it in one manifest:

```bash
node scripts/generate-agent-action.js \
  --agent codex \
  --workspace /absolute/path/to/workspace \
  --prompt "Summarize the current status" \
  --name "Status" \
  --layer 2 --row 1 --key 1 \
  --output /tmp/status-button.json
node scripts/worklouder.js apply-config /tmp/status-button.json
```

The generator discovers the login shell, detects whether the workspace is a Git repository, closes stdin, reuses an existing Smart Action with the same name, and allocates a new ID otherwise. If command permission is disabled, `--include-command-permission` requires the corresponding explicit apply gate.

## Diagnostic feedback

The bundled one-shot native macOS HUD displays a short label without a resident helper:

```bash
node scripts/build-hud.js
node scripts/generate-diagnostic-config.js \
  --layer 4 \
  --mode hud \
  --output /tmp/worklouder-diagnostics.json
node scripts/worklouder.js apply-config /tmp/worklouder-diagnostics.json
```

Review the dry run before applying. The diagnostic generator also supports `notification` and `alert` feedback modes. HUD feedback is the preferred physical-test surface because it is immediate and identifies the exact key, gesture, encoder event, or joystick sector.

Lighting is configured per layer, not per key or press. Do not build a reactive-light workflow by rapidly switching layers: physical testing showed only layer-indicator flashes, not the intermediate RGB settings. Input's live lighting preview is internal and holds the HID connection exclusively, so it is not a robust external command surface.

## Smart Actions UI gate

Firmware support, Input's editor gate, and command permission are separate checks. If Smart Actions are absent:

```bash
node scripts/enable-smart-actions.js --status
```

The patch supports the exact gate observed in Input 0.17.2. It modifies `app.asar`, invalidates the application signature, and is experimental. Use `--enable` only with explicit approval, after quitting Input. The script makes a private checksummed backup and refuses unknown/ambiguous builds. Restore from its reported backup path or reinstall Input.

## Completion standard

Report these separately:

- Input version, firmware version, profile, and active layer;
- one-based physical coordinate or encoder/joystick event;
- editor mapping and serialized device mapping;
- changed files and verified SHA-1 readback;
- whether Input received the expected event;
- whether the physical test produced the intended visible result;
- anything still unverified for this device/app version.

The goal is a reliable workflow surface, not merely valid JSON.
