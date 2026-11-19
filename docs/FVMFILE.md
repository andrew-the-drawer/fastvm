# `.fvmfile` declarative sandbox config

`.fvmfile` is a strict YAML description of a sandbox. Unknown fields are
rejected so typos are caught early. Load one with:

```sh
fastvmctl run -f hack/codex.fvmfile
fastvmctl run -f hack/codex.fvmfile -it
fastvmctl run -f hack/codex.fvmfile -d
# Claude example:
fastvmctl run -f hack/claude.fvmfile -it
# GitHub Copilot example:
fastvmctl run -f hack/copilot.fvmfile -it
# Node.js REPL example:
fastvmctl run -f hack/nodejs.fvmfile -it
# Docker-in-VM example:
fastvmctl run -d -f hack/docker.fvmfile
```

## Example

```yaml
version: 1
name: codex
image: node:26
entrypoint: ["codex"]

user_data: |
  #!/bin/sh
  set -eu
  npm install -g --no-fund --no-audit @openai/codex

env:
  OPENAI_API_KEY: "${OPENAI_API_KEY}"

network:
  enabled: true
  allow_hosts:
    - registry.npmjs.org
    - api.openai.com
    - auth.openai.com

resources:
  vcpus: 2
  memory_mb: 4096

no_auto_sleep: true
```

## Fields

| Field | Description |
|---|---|
| `version` | Optional; currently `1`. |
| `name` | Sandbox name. Defaults to the filename without `.fvmfile`. |
| `image` | Required Docker image or base disk reference; built on demand. |
| `entrypoint` | Fixed guest argv, like Docker's `ENTRYPOINT`. |
| `command` | Default arguments appended to `entrypoint`, like Docker's `CMD`. Without `entrypoint`, it is the full guest argv. |
| `env` | Guest environment for the workload, user_data, exec, and shell sessions. `${NAME}` is expanded from the host environment; unset references are an error. |
| `volumes` | `host`, `guest`, `read_only`. Relative host paths resolve against the file directory. |
| `ports` | `host`, `guest`, optional `protocol` (`tcp`/`udp`). |
| `network.enabled` | Allocate a guest NIC. |
| `network.allow_hosts` | Egress allowlist; implies `enabled: true`. |
| `resources.vcpus` / `resources.memory_mb` | Sandbox sizing; 0 uses daemon defaults. |
| `no_auto_sleep` | Disable automatic idle sleep. |
| `user_data` | Shell script run once on first boot, before `entrypoint`/`command`. |
| `user_data_file` | Script file, resolved relative to the `.fvmfile`. Mutually exclusive with `user_data`. |

CLI `--name` still overrides the file name. Resource/network/port/env flags are
not combined with `-f`; put them in the file instead. Extra `--volume` flags may
be added to a file run.

## Entrypoint and command

These follow Docker's `ENTRYPOINT` / `CMD` split:

```yaml
name: codex
image: node:26
entrypoint: ["codex"]
command: ["--help"]
```

- `entrypoint` is the fixed executable and arguments.
- `command` is the default argument list, used when no CLI args are given.
- CLI args after `--` replace `command` and are appended to `entrypoint`.

| .fvmfile | CLI | Final argv |
|---|---|---|
| `entrypoint: [codex]`, `command: [--help]` | — | `codex --help` |
| `entrypoint: [codex]`, `command: [--help]` | `-- exec` | `codex exec` |
| `command: [sleep, 10]` | — | `sleep 10` |
| `command: [sleep, 10]` | `-- sh` | `sh` |

The last two rows preserve the previous behavior for files that only use
`command`. If an entrypoint is present, CLI args no longer replace it; use
`fastvmctl exec` or a different `.fvmfile` to run another program.

## First-boot user data

`user_data` is a cloud-init-style first-boot script without a cloud-init
dependency. It runs once per sandbox, after boot and before `entrypoint`/`command`:

```yaml
user_data: |
  #!/bin/sh
  set -eu
  npm install -g --no-fund --no-audit @openai/codex
```

Or load it from a file next to the `.fvmfile`:

```yaml
user_data_file: ./setup.sh
```

Details:

- Runs with `/bin/sh -s` as root and inherits the top-level `env`.
- Maximum size: 1 MiB.
- A marker at `/var/lib/fastvm/user-data.done` prevents reruns on resume,
  wake, or snapshot restore.
- Failure aborts sandbox creation; the script's stderr is reported.
- Not supported with `--no-start`.
