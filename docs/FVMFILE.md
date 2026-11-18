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
image: dhi.io/codex
command: ["codex"]

env:
  OPENAI_API_KEY: "${OPENAI_API_KEY}"

network:
  enabled: true
  allow_hosts:
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

CLI `--name` still overrides the file name. Resource/network/volume/port/env
flags are not combined with `-f`; put them in the file instead.
