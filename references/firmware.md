# Firmware and Input compatibility

## Confirmed proof-of-concept combination

- Device: Work Louder Codex Micro
- Host: macOS over USB HID
- Input: 0.17.2
- Firmware: v0.5.0-rc.1
- Release: [Work Louder firmware v0.5.0-rc.1](https://github.com/worklouder/cm-v2-fw-releases/releases/tag/v0.5.0-rc.1)

GitHub marks v0.5.0-rc.1 as a **pre-release**, not a stable/general release. Its notes explicitly add Cheat Sheet keys and Smart Actions: commands, apps, long text, and URLs. Treat it as experimental.

## Firmware boundary

This skill does not:

- download or select a firmware image automatically;
- enter the bootloader;
- call firmware-write RPC methods;
- flash a device;
- substitute firmware from another Work Louder model.

If an update is needed, confirm the exact Codex Micro model and direct the user to Input's firmware-update UI. Let Input perform the update, reconnect the device, then verify `device.status`.

## Three independent gates

| Gate | Check | Typical failure |
|---|---|---|
| Firmware support | `device.status` | `SA_N` stores, but no `kb.sa.*` event |
| Input editor gate | `enable-smart-actions.js --status` | Smart Actions section missing |
| Command permission | Input `smartActionCmdEnabled` setting | App/URL/text work, commands disabled |

Do not collapse these into one “Smart Actions enabled” claim.

## Experimental Input patch

Input 0.17.2 contains an observed editor gate that can return false even when the firmware supports Smart Actions. The bundled patcher:

- recognizes one exact disabled or enabled gate;
- reports unknown/ambiguous bundles without modifying them;
- treats only Input 0.17.2 as a tested target;
- creates a checksummed private backup;
- preserves byte length;
- verifies the enabled gate after writing;
- supports explicit restore.

Commands:

```bash
node scripts/enable-smart-actions.js --status
node scripts/enable-smart-actions.js --enable
node scripts/enable-smart-actions.js --restore /reported/backup/path.asar
```

Quit Input before enabling or restoring.

Patching `app.asar` invalidates Input's application code signature. macOS behavior can vary, and a future Input update may replace the patch. Recovery options:

1. restore the exact backup reported by the script; or
2. reinstall a clean copy of Input.

Do not patch an unsupported version merely because the UI is missing. `--allow-unsupported-version` is an expert override for an independently inspected build, not a normal workflow.

## Compatibility policy

For any other Input or firmware version:

1. run read-only inspection;
2. compare schema and keycode mappings;
3. use a disposable layer;
4. test key, gesture, encoder, joystick, lighting, and each Smart Action type;
5. record the combination as verified only after physical results.

The configurator preserves unknown fields where observed, but reverse-engineered compatibility is not a vendor guarantee.
