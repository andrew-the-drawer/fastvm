# `.fvmfile` declarative sandbox config

`.fvmfile` is a strict YAML description of a sandbox. Unknown fields are
rejected so typos are caught early. Load one with:

```sh
fastvmctl run -f hack/codex.fvmfile
fastvmctl run -f hack/codex.fvmfile -it
fastvmctl run -f hack/codex.fvmfile -d
# Claude example:
fastvmctl run -f hack/claude.fvmfile -it
# Node.js REPL example:
fastvmctl run -f hack/nodejs.fvmfile -it
# Docker-in-VM example:
fastvmctl run -d -f hack/docker.fvmfile
```

## Example

```yaml
version: 1
name: codex
image: node:24
command: ["codex"]

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
| `command` | Guest argv. `fastvmctl run` uses it for foreground/`-it` execution. |
| `env` | Guest environment. `${NAME}` is expanded from the host environment; unset references are an error. |
| `volumes` | `host`, `guest`, `read_only`. Relative host paths resolve against the file directory. |
| `ports` | `host`, `guest`, optional `protocol` (`tcp`/`udp`). |
| `network.enabled` | Allocate a guest NIC. |
| `network.allow_hosts` | Egress allowlist; implies `enabled: true`. |
| `resources.vcpus` / `resources.memory_mb` | Sandbox sizing; 0 uses daemon defaults. |
| `no_auto_sleep` | Disable automatic idle sleep. |
| `user_data` | Shell script run once on first boot, before `command`. |
| `user_data_file` | Script file, resolved relative to the `.fvmfile`. Mutually exclusive with `user_data`. |

CLI `--name` still overrides the file name. Resource/network/volume/port/env
flags are not combined with `-f`; put them in the file instead.

## First-boot user data

`user_data` is a cloud-init-style first-boot script without a cloud-init
dependency. It runs once per sandbox, after boot and before `command`:

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
