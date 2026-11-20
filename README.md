# fastvm

Micro-VMs that nap.

A single-host sandbox runtime built on **Cloud Hypervisor**/KVM: sandboxes
cold-boot in **~0.6 s** (measured to guest-agent-ready on the reference host),
put themselves to sleep when idle, page their memory to disk, and wake
themselves when a packet arrives — with the frame already queued in the guest's
own virtio-net path. Host directories can be shared into a sandbox over
virtio-fs.

![fastvm console in light and dark themes](docs/CONSOLE_THEMES.png)

## Features

- **Fast microVMs.** Cloud Hypervisor/KVM sandboxes boot to agent-ready in ~0.6 s.
- **Disposable or persistent.** `run` builds, boots, runs, and removes on exit;
  `-d` keeps it, and `resume` boots/wakes it later.
- **Self-managing.** Idle → pause → dormant RAM snapshot → wake on network.
- **On-demand images.** First use of an OCI image pulls it and caches a bootable
  disk automatically; compressed layers are shared across images.
- **Network control.** `--net`/`--no-net`, plus `--allow-host` egress allowlists.
- **First-boot setup.** Run a cloud-init-style `user_data` script before the sandbox command.
- **Snapshots.** Save RAM/CPU/disk and restore independent copies.
- **Volumes and ports.** virtio-fs host mounts and nftables published ports.
- **Declarative configs and console.** Run `.fvmfile` sandboxes (e.g. coding
  agents), and use the OIDC web console.

## Try it

Build and install the binaries and pinned kernel, then run the daemon and drive
it with `fastvmctl`:

```sh
# build and install (usually /usr/local/bin)
make build && make assets   # binaries + pinned Cloud Hypervisor kernel
sudo make install

# terminal 1 — root daemon with the demo config
sudo fastvmd --config hack/config.yaml

# terminal 2
# one-shot command: image pulled on demand, output printed, sandbox removed on exit
fastvmctl run --image alpine -- uname -a

# interactive shell: removed when you exit
fastvmctl run --net -it --image alpine -- /bin/sh

# named sandbox you can exec into, pause, and wake
fastvmctl run -d --net --image alpine --name dev -- sh -c 'sleep infinity'
fastvmctl exec dev -- uname -a
fastvmctl pause dev --deep
fastvmctl resume dev
fastvmctl rm dev

# egress allowlist: only example.com is reachable; google.com fails fast
fastvmctl run --image alpine --allow-host example.com -- \
  wget -T 2 -t 1 -qO- https://google.com
```

Host volumes, published ports, snapshots, and declarative configs are covered
in [docs/FASTVMCTL.md](docs/FASTVMCTL.md); see
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) for the full walkthrough and
[docs/FVMFILE.md](docs/FVMFILE.md) for the config format.

## Snapshots

A snapshot saves the sandbox’s running state — RAM, CPU, and writable disk —
so it can be restored as one or more independent sandboxes.

```sh
# Boot the original with a long-running workload
fastvmctl run -d --net --image alpine --name original-vm -- sh -c 'sleep 600'

# Change its state after boot, so copies prove they came from the live VM
fastvmctl exec original-vm -- sh -c 'echo "created before snapshot" > /root/snapshot-source.txt'

# Save the running state; this prints the generated snapshot name
snapshot=$(fastvmctl snapshot original-vm --name before-upgrade)

# Restore independent copies from the same snapshot
fastvmctl run --from-snapshot "$snapshot" --name copy-1
fastvmctl exec copy-1 -- cat /root/snapshot-source.txt
fastvmctl exec copy-1 -- sh -c 'ps | grep "[s]leep 600"'   # process survived

fastvmctl run --from-snapshot "$snapshot" --name copy-2
fastvmctl exec copy-2 -- cat /root/snapshot-source.txt
fastvmctl exec copy-2 -- sh -c 'ps | grep "[s]leep 600"'  # process survived

fastvmctl snapshot ls                    # list saved snapshots
fastvmctl snapshot rm "$snapshot"   # delete it when no longer needed

fastvmctl rm copy-1 copy-2 original-vm
```

Snapshots are stored under the daemon data directory
(`<data_dir>/snapshots/<name>`), so the disk can be reflinked on CoW
filesystems. The base image referenced by the snapshot must still exist when
restoring. Host-directory mounts are not included in snapshots.

## Web console

Setup, OIDC, the exec terminal and API details live in [console/README.md](console/README.md).

## Requirements

Linux x86_64 with KVM, [Cloud Hypervisor](https://www.cloudhypervisor.org/)
v54+ (`cloud-hypervisor`, or the static build `cloud-hypervisor-static`),
virtiofsd ≥ 1.10 (only for host-directory volumes), and Go 1.24+ to build. The
daemon needs root/`CAP_NET_ADMIN` for TAP/veth/nftables; `CAP_BPF` enables the
eBPF switch, otherwise it falls back to the Linux bridge. Images are pulled
directly from OCI registries; no Docker daemon or CLI is required.

## Documentation

| Document | What it covers |
|---|---|
| [Getting started](docs/GETTING_STARTED.md) | Build, config, images, sandboxes, shell, wake-on-network, testing, troubleshooting |
| [Design](docs/DESIGN.md) | Goals, architecture, lifecycle, storage, networking, security, roadmap |
| [CoW volumes](docs/SETUP_COW_VOLUME.md) | Loopback XFS setup, reflink verification |
| [Cloud Hypervisor migration](docs/CLOUD_HYPERVISOR_MIGRATION.md) | Why the VMM moved from Firecracker to Cloud Hypervisor, kernel/tooling, virtio-fs volumes |
| [fastvmctl CLI](docs/FASTVMCTL.md) | Command surface, lifecycle semantics, networking/allowlists, snapshots |
| [`.fvmfile` configs](docs/FVMFILE.md) | Declarative sandbox configs for coding agents and reproducible runs |
| [Auto-publishing ports](docs/AUTO_PUBLISH.md) | Discover guest TCP listeners and publish them on 127.0.0.1 |
| [Web console](console/README.md) | OIDC login, sandbox dashboard, live utilization, exec terminal, dev proxy, production notes |
| [Docs index](docs/README.md) | All documents and the repository layout |

## Development

```sh
make build     # bin/fastvmctl, bin/fastvmd, bin/fastvm-agent
make test      # unit tests (no KVM or root needed)
make test-race # unit tests under the race detector
make e2e       # real Cloud Hypervisor boot/pause/dormant/wake e2e
```

Gated e2e and network suites skip cleanly when their
prerequisites are missing — see
[docs/GETTING_STARTED.md § Testing](docs/GETTING_STARTED.md#10-testing) for the
commands and the verified test matrix.
