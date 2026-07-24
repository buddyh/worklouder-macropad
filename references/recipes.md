# Workflow recipes

Choose the native Smart Action type whenever possible. Use `CMD_STEP` only when an actual program must run.

## Native recipes

### Open an app

```json
{
  "id": 1,
  "name": "Open app",
  "type": "APP_STEP",
  "payload": {
    "name": "Example",
    "path": "/Applications/Example.app"
  }
}
```

Discover the real path with Spotlight or `mdfind`; do not assume every app lives directly under `/Applications`.

### Open a URL

```json
{
  "id": 2,
  "name": "Open page",
  "type": "URL_STEP",
  "payload": {"url":"https://example.com/work"}
}
```

### Insert text

```json
{
  "id": 3,
  "name": "Insert text",
  "type": "TEXT_STEP",
  "payload": {"text":"A fixed, non-secret snippet"}
}
```

Do not store passwords, API keys, recovery codes, or private tokens on the device.

## Command rules

Input 0.17.2 passes `CMD_STEP` to Electron's `child_process.exec`. It launches from a GUI environment, not an interactive terminal. Before creating the action:

1. Resolve the executable with `command -v`.
2. Store its absolute path.
3. Select an explicit execution context or working directory.
4. Close stdin with `</dev/null` for non-interactive agent CLIs.
5. Avoid aliases and shell functions unless explicitly invoking a login shell.
6. Decide timeout, overlap, logging, and notification behavior.
7. Put credentials in the program's private configuration, never in the Smart Action.

Test the exact payload under `/bin/sh -c`, not only in an interactive terminal:

```bash
/bin/sh -c '/absolute/path/to/program arguments </dev/null'
```

Prefer a stable wrapper. When a command intentionally depends on the user's shell initialization, invoke the shell explicitly:

```text
/bin/zsh -lic '/absolute/path/to/program arguments' </dev/null
```

This is a portability option, not a reason to depend on undocumented aliases. Keep the actual executable and context explicit whenever possible.

## Visible feedback

Build the bundled one-shot native HUD:

```bash
node scripts/build-hud.js
```

Its default binary can be invoked by a `CMD_STEP` and exits after displaying a brief non-activating label. It is the preferred diagnostic feedback because it does not require a resident helper.

Notification Center is a dependency-free fallback:

```text
/usr/bin/osascript -e 'display notification "The button worked" with title "Work Louder"'
```

The diagnostic generator supports all three feedback modes:

```bash
node scripts/generate-diagnostic-config.js \
  --layer 4 \
  --mode hud \
  --output /tmp/worklouder-diagnostics.json
```

Use `--mode notification` for banners or `--mode alert` for a timed foreground alert. Notification settings can suppress banners; alerts are more intrusive.

## Execution contexts

Agent buttons should resolve a named context to an absolute directory. A user-owned configuration might define a `default` context for general buttons plus names such as `documentation`, `operations`, or `project-a`. Each button selects a context by name; generated commands contain the resolved path, never a public hardcoded path.

Validate that the directory exists. For Git-aware tools, detect whether it is a repository and add any non-repository override only when the user intentionally selected a non-Git context.

The bundled generator applies these rules and can optionally map the result:

```bash
node scripts/generate-agent-action.js \
  --agent codex \
  --workspace /absolute/workspace \
  --prompt "Review active work" \
  --name "Review work" \
  --layer 2 --row 1 --key 1 \
  --output /tmp/review-work.json
```

Omit `--layer`, `--row`, and `--key` together to generate an unmapped Smart Action. Review with `worklouder.js apply-config` before applying. If Input command permission is disabled, the generator refuses unless `--include-command-permission` is explicit; the apply then also requires `--allow-command-execution`.

## Codex

Resolve `codex`, then create a constrained non-interactive task:

```text
/absolute/path/to/codex exec --ephemeral -C "/absolute/workspace" --sandbox read-only "Review current status and write a concise report" </dev/null
```

For an intentionally non-Git context:

```text
/absolute/path/to/codex exec --ephemeral -C "/absolute/workspace" --skip-git-repo-check --sandbox read-only "Review current status and write a concise report" </dev/null
```

`--skip-git-repo-check` does not select a directory and does not replace `-C`. For a mutating workflow, choose the sandbox and prompt deliberately. Avoid bypass flags. Consider writing the final response to a known file with `--output-last-message`, then notifying the user.

## Claude Code

Resolve `claude`, then run a one-shot prompt:

```text
/absolute/path/to/claude -p --no-session-persistence "Summarize the current project status"
```

Add an explicit project directory through a small wrapper or a leading `cd`, and close stdin. Non-interactive mode skips the workspace trust dialog, so target only a directory the user trusts.

## OpenClaw

OpenClaw requires a session selector. Resolve `openclaw`, then use one of:

```text
/absolute/path/to/openclaw agent --agent <agent-id> --message "Summarize current status" --timeout 120 --json
```

```text
/absolute/path/to/openclaw agent --session-key <session-key> --message "Run the routine" --timeout 120 --json
```

Add `--deliver` only when the user intends the response to be sent to the selected channel/target. See the current [OpenClaw agent CLI reference](https://docs.openclaw.ai/cli/agent).

## Local automation

Prefer invoking an existing stable script:

```text
/absolute/path/to/project/scripts/run-daily-report
```

Good command buttons:

- refresh a cache or dataset;
- run a known report;
- start a focused agent review;
- capture a screenshot;
- toggle a local service through its supported CLI;
- enqueue a recurring workflow now;
- open the latest generated artifact;
- send a non-sensitive completion notification.

## Multi-step workflows

Input Smart Actions are single operations. For a durable multi-step command, invoke one wrapper that owns:

- executable plus argument array;
- working directory;
- minimal environment allowlist;
- timeout and cancellation;
- overlap policy;
- log destination;
- success/failure notification;
- secret lookup from private configuration.

Inside a wrapper, prefer process spawning without a shell. The Smart Action should contain only the wrapper path and a recipe identifier:

```text
/absolute/path/to/workflow-runner <recipe-id>
```

This keeps quoting, secrets, and workflow logic out of Input's database while retaining one-button execution.

## Layout heuristics

- Keep stock Layer 1 intact.
- Give each added layer one theme: navigation, communication, build/test, media, or app-specific controls.
- Put high-frequency, low-risk actions on tap.
- Put destructive or expensive actions on hold or tap+hold.
- Use double tap for a related “stronger” variant.
- Use lighting to make layer identity obvious.
- Do not use layer-switch macros as reactive lighting; physical testing showed indicator flashes without intermediate RGB effects.
- Reserve encoder turns for continuous or reversible controls.
- Keep joystick sectors few enough to select reliably.
- Include a way back to Layer 1 on every custom layer.
