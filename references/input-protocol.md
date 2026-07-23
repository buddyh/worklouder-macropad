# Input storage and HID protocol

This is a reverse-engineered compatibility layer for the Work Louder Codex Micro on macOS. It is not an official API.

## Storage surfaces

```text
~/Library/Application Support/input/input_storage.json
~/Library/Application Support/input/devices/<discovered-product-id>/keymap.json
~/Library/Application Support/input/devices/<discovered-product-id>/smart_actions.json
~/Library/Logs/input/main.log
/Applications/input.app/Contents/Resources/app.asar
```

Discover the device record by `device.deviceType == "codex_micro"`. Do not hardcode a product ID or HID path:

- product IDs may differ by model/build;
- HID paths change across reconnects;
- multiple matching records require an explicit `INPUT_DEVICE_PID`.

The device is authoritative for deployed `keymap.json` and `smart_actions.json`. Input's database is authoritative for editable profiles, definitions, app settings, and cached checksums. Update the device, cache, and database together or Input may overwrite direct changes.

## HID framing

Input's bundled native HID addon uses 64-byte reports:

- byte `0`: report ID `0x06`;
- byte `1`: channel `2` for JSON-RPC;
- byte `2`: payload byte count;
- bytes `3..63`: up to 61 UTF-8 bytes.

Requests are newline-terminated JSON objects:

```json
{"method":"device.status","params":null,"id":9000}
```

Large requests are split across 61-byte HID reports. Responses are accumulated until newline and routed by request ID.

## RPC methods

Observed:

```text
sys.version
device.status
fs.list
fs.readbin
fs.writebin
fs.delete
fs.txbegin
fs.txcommit
lights.preview
ui.home_accent_color
```

The public configurator uses only status, listing, chunked reads, and chunked writes. Transactions, direct lighting preview, delete, and accent-color behavior remain unverified and are not default mutation paths.

## File reads and writes

Read in byte chunks:

```json
{"file":"keymap.json","offset":0,"len":3072}
```

Continue until `offset >= total_size`. Concatenate bytes before UTF-8 decoding so multibyte characters cannot split incorrectly.

Write files in 3072-byte chunks:

```json
{
  "file": "keymap.json",
  "data": "<base64>",
  "append": true,
  "completed": false,
  "offset": 0
}
```

Set `completed: true` only on the final chunk. Input ASCII-escapes non-ASCII code points before writing JSON; the configurator mirrors that behavior.

After every write:

1. read the complete file back;
2. compare exact bytes;
3. parse the JSON;
4. compute local SHA-1;
5. compare it with `fs.list {checksum:true}`.

## Safe mutation sequence

1. Quit Input so it does not own or race the HID connection.
2. Acquire the configurator lock.
3. Read `fs.list` with checksums.
4. Read both device files.
5. Create private `0700` backup directory and `0600` files.
6. Re-read `fs.list`; abort if checksums changed.
7. Validate the complete desired graph.
8. Write only changed files, Smart Actions before keymap.
9. Verify exact readback and SHA-1.
10. If a later write fails, restore every earlier changed file and verify it.
11. Atomically update Input cache files and database.
12. Release HID and lock.
13. Relaunch Input for host Smart Action handlers.

## Keymap shape

Top level:

```text
version
activeProfileId
language
profiles
multiActions
macros
macrosGroups
multiActionsGroups
deviceSpecificConfig
linkedApps
```

Preserve `language`, `deviceSpecificConfig`, unknown vendor keycodes, and editor structures the skill does not understand.

Each profile stores:

```text
id
name
layers
fpLayer
macrosUsed
multiActionsUsed
```

`macrosUsed` includes Actions reached directly from controls, through used Multi Actions, and recursively through nested Actions. `multiActionsUsed` includes direct Multi Action references.

## Smart Actions shape

```json
{
  "version": 1,
  "smartActions": {
    "SA_6": {
      "name": "Open page",
      "type": "URL_STEP",
      "payload": {"url":"https://example.com"}
    }
  },
  "smartActionGroups": []
}
```

Keys must match `^SA_(0|[1-9]\d*)$`.

Observed firmware-to-host notifications:

```text
kb.sa.inserttext
kb.sa.exec
kb.sa.openapp
kb.sa.openurl
kb.radial
```

A successful file write proves storage only. Notification receipt and host completion are separate verification stages.

## Environment overrides

```text
INPUT_APP
INPUT_ASAR
INPUT_DATABASE
INPUT_SUPPORT_ROOT
INPUT_DEVICE_TYPE
INPUT_DEVICE_PID
INPUT_HID_ADDON
WORKLOUDER_BACKUP_DIR
```

Use overrides for discovery and test fixtures; do not bake machine-specific values into a public manifest.
