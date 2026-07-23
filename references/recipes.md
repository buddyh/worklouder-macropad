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

Input launches a command from a GUI environment. Before creating the action:

1. Resolve the executable with `command -v`.
2. Store its absolute path.
3. Use an explicit project directory.
4. Avoid aliases, shell functions, and login-shell initialization.
5. Decide timeout, overlap, logging, and notification behavior.
6. Put credentials in the program's private configuration, never in the Smart Action.

Test the exact payload under `/bin/sh -c`, not only in an interactive terminal:

```bash
/bin/sh -c '/absolute/path/to/program arguments'
```

## Visible smoke test

```text
/usr/bin/osascript -e 'display notification "The button worked" with title "Work Louder"'
```

Use this before debugging a more complex agent command.

## Codex

Resolve `codex`, then create a constrained non-interactive task:

```text
/absolute/path/to/codex exec --ephemeral -C "/absolute/project" --sandbox read-only "Review current status and write a concise report"
```

For a mutating workflow, choose the sandbox and prompt deliberately. Avoid bypass flags. Consider writing the final response to a known file with `--output-last-message`, then notifying the user.

## Claude Code

Resolve `claude`, then run a one-shot prompt:

```text
/absolute/path/to/claude -p --no-session-persistence "Summarize the current project status"
```

Add an explicit project directory through a small wrapper or a leading `cd`. Non-interactive mode skips the workspace trust dialog, so target only a directory the user trusts.

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
- Reserve encoder turns for continuous or reversible controls.
- Keep joystick sectors few enough to select reliably.
- Include a way back to Layer 1 on every custom layer.
