---
name: worklouder-macropad
description: Inspect, design, configure, back up, and physically verify Work Louder Codex Micro workflows through the macOS Input app. Use for keys, six layers, profiles, Actions, Multi Actions, Smart Actions, commands, app/URL/text actions, encoder controls, radial joystick sectors, lighting, linked-app layers, firmware compatibility, or diagnosing buttons that save but do not execute.
---

# Work Louder Macropad

Configure the device as an agent-assisted control surface while preserving the user's working layout. The bundled CLI edits every Codex Micro surface currently exposed by Input 0.17.2 and firmware v0.5.0-rc.1. Treat other versions as unverified until inspected and physically tested.

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
- [recipes.md](references/recipes.md): portable app, URL, text, command, Codex, Claude, and OpenClaw patterns.
- [hardware-verification.md](references/hardware-verification.md): Layer 3 test matrix for keys, gestures, encoder, joystick, lighting, layers, and AppSense.
- [input-protocol.md](references/input-protocol.md): Input storage, HID RPC, serialization, checksums, and recovery.
- [firmware.md](references/firmware.md): firmware, Input version, Smart Actions gate, code-signing, and recovery.
- [keycodes.md](references/keycodes.md): keycode families and layer/profile switching.

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

## Smart Actions

Firmware stores a trigger such as `SA_3`; Input stores the definition and executes it on macOS. A valid definition without a mapped control is unreachable. A mapped `SA_N` without a definition is inert.

Supported types:

| Type | Payload | Behavior |
|---|---|---|
| `APP_STEP` | `name`, `path` | Open an application |
| `URL_STEP` | `url` | Open a URL |
| `TEXT_STEP` | `text` | Insert fixed text |
| `CMD_STEP` | `cmd` | Run one command through Input's GUI shell |

For commands, resolve executables to absolute paths and use explicit working directories. Do not rely on aliases, shell functions, terminal initialization, or secrets embedded in payloads. Prefer a stable wrapper for long-running, stateful, or credentialed workflows.

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
