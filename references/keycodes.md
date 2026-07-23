# Keycode families

Input stores editor-facing keycodes and remaps some references when writing firmware files.

| Prefix | Meaning | Device serialization |
|---|---|---|
| `KC_` | Keyboard/media/basic key | Usually unchanged |
| `KI_` | Input/firmware function | Usually unchanged |
| `KA_` | Action reference | `KA_3` → `KA_A3` |
| `KM_` | Multi Action reference | `KM_3` → `KA_M3` |
| `SA_` | Smart Action reference | Unchanged |
| `KV_` | Vendor stock Codex behavior | Preserve; do not synthesize |

Input decodes legacy `KC_FUNC...` references to `KI_FP...` for the editor. Do not invent function-pad mappings until verified.

## Layer and profile switching

Observed function families:

- `KI_LS1` through `KI_LS6`: switch to layer 1–6;
- `KI_LM1` through `KI_LM6`: momentary layer 1–6;
- `KI_PS1` through `KI_PS6`: switch profile 1–6.

Use Input's current key picker as the authority for all ordinary keyboard, numpad, media, brightness, and system keycodes. The public skill does not claim an exhaustive list because the catalog can vary by device, firmware, and OS.

## Safe rules

- Preserve unknown `KV_` values byte-for-byte.
- Reject references whose Action, Multi Action, or Smart Action definition is missing.
- Reject Action cycles.
- Do not nest Multi Actions until that behavior is physically proven.
- Keep Layer 1 protected unless explicitly authorized.
- Validate every generated code against the live Input catalog when possible.
