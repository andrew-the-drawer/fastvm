# fastvmctl CLI

`fastvmctl` is the redesigned CLI for fastvm. It uses
[Fang](https://github.com/charmbracelet/fang) + Cobra, so `--help`, `--version`,
shell completion, and command/flag errors are styled consistently. The `fastvm`
binary is kept as a compatibility symlink while scripts migrate.

Status: **implemented** — on-demand images, network toggle/allowlist,
interactive run, unified run/resume lifecycle, checkpoints, live copies, and
restore.

Some limitations are called out below (allowlist requires the bridge data
plane; checkpoints do not include host volume mounts yet).

## Conventions

The CLI is built on Cobra and styled by Fang. Use `fastvmctl --help`, command
`--help`, and `fastvmctl completion <shell>` for discovery/completion.

- The daemon socket is the global `--socket` flag (or `FASTVM_SOCKET`); the old
  single-dash `-socket` form is gone.
- Interactive commands use `-i/--interactive` and `-t/--tty`; the combined
  `-it` shorthand still works.
- Guest commands should follow `--`, e.g. `exec <sandbox> -- uname -a`.
- `-v/--version` is provided by Fang; `version` reports both CLI and daemon.

## Commands

```sh
# Build/run; the image is built into a base disk on demand from the Docker
# image reference if it is not in the local image store.
# Foreground (waits, prints the command output):
fastvmctl run --net --image alpine -- uname -a
# Detached (prints only the sandbox ID/state/name):
fastvmctl run -d --net --image alpine -- uname -a
fastvmctl run --net -it --image alpine -- /bin/sh

# Egress allowlist: only the named hosts (plus DNS and established traffic)
# can be reached. Requires bridge switch mode.
fastvmctl run --net --allow-host registry.npmjs.org --image alpine -- wget -qO- https://google.com

# Lifecycle: --no-start creates without booting; resume boots/wakes it.
fastvmctl run --net --name agent --image alpine --no-start
fastvmctl resume --name agent

# Or create+boot in one step
fastvmctl run --net --name agent --image alpine

# Checkpoints: save the running state, make a live copy, or restore a saved one.
fastvmctl checkpoint save --name agent -o agent.checkpoint
fastvmctl checkpoint copy --from agent --name try-1
fastvmctl checkpoint restore --from agent.checkpoint --name agent2

# Existing commands
fastvmctl ls
fastvmctl get <ref>
fastvmctl exec [-it] <ref> -- <cmd>...
fastvmctl shell <ref>
fastvmctl pause <ref> [--deep]
fastvmctl resume <ref>
fastvmctl rm <ref>...
fastvmctl events [-n N]
fastvmctl image <build|ls|rm>
fastvmctl version
```

Global socket selection: `--socket <path>` before the command, or
`FASTVM_SOCKET`; default `/run/fastvm/fastvm.sock`.

## Semantics

- **Network is off by default** for `run`. `--net` allocates a TAP and
  guest IP; `--no-net` states that explicitly. Without networking the guest has
  no NIC.
- `--allow-host` switches the sandbox to allowlist mode: hostnames are resolved
  to IPv4 at create time, DNS and established traffic are allowed, other egress
  is rejected (TCP gets an immediate RST, so blocked wget/curl fail fast). The allowlist is enforced by nftables on the bridge data plane;
  eBPF switch mode rejects allowlisted sandboxes until a tc/BPF filter exists.
  DNS rebinding/CDN IP changes are not tracked yet.
- `-it` attaches the CLI to a PTY for the given command (default `/bin/sh`).
- `run` creates and boots a sandbox by default. With a command it runs in the
  foreground, writes the command's stdout/stderr, and **removes the sandbox when
  it exits**. `-it` does the same for an interactive shell. `-d/--detach` starts
  the command as the detached workload and keeps the sandbox; it prints the
  sandbox ID/state/name. A `run` without a command leaves the sandbox running
  and prints the sandbox ID/state/name.
- `run --no-start` creates without booting. Use `resume` to boot it later.
  `run --name <ref>` boots/wakes an existing sandbox.
- `resume` makes an existing sandbox active: `Created` -> boot, `Paused` ->
  wake, `Dormant` -> restore.
- On-demand image builds show a Bubbles v2 spinner with elapsed time on an
  interactive terminal. Non-TTY/CI invocations get a single status line on
  stderr instead, so stdout stays parseable. Use `image build` for explicit
  Dockerfile builds.
- `checkpoint -o DIR` writes `checkpoint.json`, `snapshot/` (CH config, memory,
  CPU state) and `disk.img`. Running sandboxes are paused only for the snapshot
  and resumed afterwards. Host volume mounts are not captured yet.
- `checkpoint save --name REF -o DIR` writes `checkpoint.json`, `snapshot/`
  (CH config, memory, CPU state) and `disk.img`. Running sandboxes are paused
  only for the snapshot and resumed afterwards. Host volume mounts are not
  captured yet.
- `checkpoint copy --from PARENT --name CHILD` makes a live copy: the parent is
  paused briefly, the child is restored running with its own writable disk, IP,
  and hostname. Disk cloning uses reflink where the filesystem supports it and
  sparse copy otherwise; guest RAM is snapshotted and restored.
- `checkpoint restore --from DIR --name REF` restores the checkpoint and boots
  it running; the restored sandbox gets a new TAP/IP (when the checkpoint had
  networking) and a new hostname via the guest agent. The base image referenced
  by the checkpoint must still exist in the image store.
- Images are cached by Docker reference; use `image ls` to inspect them.
  Rebuild base images after changing the guest agent (checkpoint restores use
  the agent's `network`/`hostname` ops for the new sandbox identity).
- Build identity is included in `version`/`--version`
  (`<tag|commit>[-dirty]`).

## Limitations / follow-ups

- Checkpoints with host volume mounts are rejected.
- Allowlists are bridge-only (eBPF mode returns a clear error).
- Hostname/IP reconfiguration needs a guest agent built with the `network` and
  `hostname` ops; rebuild images after upgrading the agent.
- Checkpoint output paths are daemon-host paths, not client-side uploads.
- `checkpoint restore` starts the restored VM immediately (no stopped/paused
  restore state yet).
