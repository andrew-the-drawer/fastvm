# fastvm on macOS

fastvm is built on Cloud Hypervisor and KVM, so it cannot run natively on macOS
today. There are two ways to close that gap:

| | Approach | Status |
|---|---|---|
| **Phase 1** | Run `fastvmd` inside a Linux VM (Lima, Apple Virtualization.framework) with **nested virtualization**; drive it from a native macOS `fastvmctl`. | **Available, experimental.** |
| **Phase 2** | A native macOS backend: a Virtualization.framework VMM driver plus userspace networking, with no Linux VM in between. | Planned; see [Phase 2](#phase-2-native-virtualizationframework-backend-planned) and [TODO.md](../TODO.md). |

Phase 1 runs the same daemon, VMM, and guest kernel as production, so behavior
matches a Linux host. It costs one extra VM layer and needs a recent Mac.
Phase 2 removes that layer and works on any Apple Silicon Mac, but most of the
platform code below the daemon has to be reimplemented.

---

## Phase 1: fastvmd in a Lima VM

### Requirements

| Requirement | Why |
|---|---|
| Apple Silicon **M3 or newer** | Apple only exposes nested virtualization (EL2) on M3+. On M1/M2 the VM has no `/dev/kvm` and provisioning stops with an explicit error. |
| **macOS 15** or newer | `VZGenericPlatformConfiguration.isNestedVirtualizationEnabled` |
| [Lima](https://lima-vm.io) **2.0+** | `brew install lima` |
| Go (version from `go.mod`) | Cross-compiles the linux/arm64 daemon and agent, and the native CLI |

Guests are **arm64 only**: images are pulled for `linux/arm64`, and x86_64-only
images will not run.

### Quick start

```sh
make mac-up                              # build, fetch kernel, create VM, start fastvmd
eval "$(hack/lima/fastvm-lima.sh env)"   # point fastvmctl at the VM
bin/fastvmctl run --image alpine -- uname -a
```

The first `mac-up` downloads a Debian 13 cloud image (~400 MB) and installs a
few packages in the VM. Later runs reuse the VM.

Everything in the [Getting started](GETTING_STARTED.md) walkthrough works from
the Mac with `bin/fastvmctl`: `run`, `-it` shells, `exec`, `pause --deep`,
`resume`, snapshots, `--allow-host`, `.fvmfile`s and host volumes.

### Commands

`make mac-<cmd>` and `hack/lima/fastvm-lima.sh <cmd>` are equivalent.

| Command | What it does |
|---|---|
| `up` | Build binaries, fetch the arm64 kernel, generate certificates, create/start the VM, provision it, and start `fastvmd`. |
| `start` | Start the VM if it is stopped, re-provision, and restart `fastvmd`. Run it after rebuilding (`make mac-build`) to pick up new binaries. |
| `stop` | Stop the VM. Sandboxes stop with it. |
| `delete` | Delete the VM, with every sandbox, image, and snapshot in it. |
| `env` | Print `FASTVM_HOST` / `FASTVM_CERT_PATH` exports for the native CLI. |
| `status` / `logs` | VM status, and a live follow of the `fastvmd` journal. |
| `shell [cmd…]` | Shell (or a command) in the VM. |
| `forward PORT…` | Tunnel published sandbox ports to the Mac (see [Published ports](#published-ports)). |
| `e2e` | Run the real-VM e2e suite (`make e2e`) as root in the VM. Installs a pinned Go toolchain there on first use. |

`FASTVM_LIMA_INSTANCE` overrides the VM name (default `fastvm`).
`FASTVM_LIMA_STATE` overrides the host state directory (default
`~/.fastvm/lima`, which must be under `$HOME`).

### How it works

```
macOS                               Lima VM (Debian 13, arm64, vz + nested virt)
─────                               ─────────────────────────────────────────────
bin/fastvmctl ── mTLS ─► 127.0.0.1:8443 ─► fastvmd (systemd, root)
  (darwin/arm64)   (Lima port forward)        │  bridge + nftables, XFS reflink CoW
                                              ▼
~/ (read-only) ── virtiofs mount ─►     cloud-hypervisor v55 (static aarch64)
/tmp/lima (rw)                                │  KVM via nested virtualization
                                              ▼
                                        sandbox microVM (arm64 guest kernel)
```

| Piece | Where |
|---|---|
| Lima template | [`hack/lima/fastvm.yaml`](../hack/lima/fastvm.yaml): 4 vCPU, 8 GiB, 60 GiB disk. Debian 13 through Lima's digest-pinned image list. |
| Provisioning | [`hack/lima/provision.sh`](../hack/lima/provision.sh), idempotent and re-run on every `up`/`start`. Installs `nftables`, `xfsprogs`, `virtiofsd`, and a SHA-256-pinned Cloud Hypervisor. Creates the CoW filesystem and writes the config and systemd unit. |
| Binaries | Cross-compiled on the Mac into `bin/linux-arm64/` and run from the read-only mount. `bin/fastvmctl` is the native macOS build. |
| Guest kernel | `test/e2e/assets/vmlinux.bin`, fetched with `FASTVM_ARCH=arm64 make assets` (Cloud Hypervisor's `Image-arm64`, SHA-256 pinned). |
| Daemon config | `/etc/fastvm/config.yaml` in the VM, regenerated on each start. |
| Data | `/var/lib/fastvm-cow/data`, on a sparse 40 GB XFS loop image with `reflink=1`, inside the VM disk. |
| API certificates | `~/.fastvm/lima/certs/{server,client}` on the Mac, created by `make certs`. |

The daemon's unix socket is root-only (`0600`), so the Mac does not use it.
fastvmctl uses the existing mTLS TCP API instead
([API.md](API.md)). Lima forwards the guest's
`127.0.0.1:8443` to the Mac automatically, so that port must be free on the Mac.

The VM uses the **bridge** switch, not eBPF, because egress allowlists
(`--allow-host`) are not implemented in eBPF mode yet. Wake-on-network uses the
bridge AF_PACKET path.

### Host-directory volumes

The daemon in the VM resolves volume paths, so a path only works if it is
mounted into the VM at the same location:

| Mac path | In the VM | Use |
|---|---|---|
| anything under `~` | read-only | `-v ~/src/app:/app:ro` |
| `/tmp/lima/...` | read-write | `-v /tmp/lima/work:/work` |

Both are in the daemon's `volumes.allowed_host_prefixes`. A read-write volume
under `~` mounts, but guest writes fail, because the Lima mount itself is
read-only. To share a writable directory from your home, add a writable mount
to the template.

### Published ports

`--publish` and `--auto-publish` work inside the VM: from `fastvmctl shell`, or
from `limactl shell fastvm curl 127.0.0.1:<port>`. They are **not** reachable
from the Mac automatically. fastvm publishes with nftables DNAT, which opens no
listening socket, and Lima's automatic forwarder only notices listening
sockets. Tunnel the ports you need instead:

```sh
bin/fastvmctl run -d --net --publish 8080:80 --image nginx --name web
hack/lima/fastvm-lima.sh forward 8080      # foreground; Ctrl-C closes it
curl http://127.0.0.1:8080/
```

### Measured (Apple M5 Max, macOS 27, Lima 2.3)

| Check | Result |
|---|---|
| Real-VM e2e suite (`make mac-e2e`) | 12/12 pass, none skipped: lifecycle, dormant snapshot/restore, wake-on-network, CLI over the socket, daemon binary |
| `fastvmctl run --image alpine -- true` (create, boot, exec, remove, warm image cache) | ~3.0 s end to end, from the Mac over mTLS |
| Egress, `--allow-host`, deep pause → Dormant → resume, `-it` shell, `:ro` home volume, read-write `/tmp/lima` volume, `--publish` + `forward` | Working |

The ~0.6 s figure in the README is time to agent-ready on a bare-metal x86 KVM
host. The 3 s here also includes CLI round trips, CoW clone and teardown, and
nested-virtualization overhead. The two numbers are not directly comparable.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `provision: error: /dev/kvm is missing` | The Mac or macOS version does not support nested virtualization (M3+ and macOS 15+ are needed). Use Phase 2 once it lands, or a Linux host. |
| fastvmctl: `connection refused` on `127.0.0.1:8443` | Run `hack/lima/fastvm-lima.sh status`, then `logs`. Make sure nothing else on the Mac uses port 8443. |
| `exec format error`, or an image has no arm64 variant | Guests are arm64; use a multi-arch image. |
| Code changes have no effect | `make mac-build && make mac-start` (binaries are only picked up on a daemon restart). |
| Volume: `not under an allowed prefix` / guest write fails | See [Host-directory volumes](#host-directory-volumes). |

---

## Phase 2: native Virtualization.framework backend (planned)

The goal is `fastvmd` running directly on macOS (any Apple Silicon Mac, no
nested virtualization), with Apple's **Virtualization.framework** (VZ) in place
of Cloud Hypervisor. Apple ships two layers: Hypervisor.framework is low-level
(roughly KVM), and VZ is a complete VMM with virtio devices built in. VZ is the
right fit. Apple's own
[Containerization](https://github.com/apple/containerization) package, which
runs each Linux container in its own lightweight VZ VM, shows the model works.

The daemon already talks to the VMM only through `vmm.Driver` / `vmm.VM`
([`internal/vmm/vmm.go`](../internal/vmm/vmm.go)), and to networking through
`network.Manager`. The work is mostly the Linux-only platform code below
those interfaces.

### Feature mapping

| fastvm feature | Linux today | macOS with VZ |
|---|---|---|
| Boot | Cloud Hypervisor + `Image`/`vmlinux` | `VZLinuxBootLoader` with the same arm64 `Image` |
| Pause / resume | CH REST API | `VZVirtualMachine.pause()` / `resume()` |
| Dormant snapshot / restore | CH snapshot, file-backed memory | `saveMachineStateTo` / `restoreMachineStateFrom` (macOS 14+) |
| Host volumes | virtiofsd per volume | built in: `VZVirtioFileSystemDeviceConfiguration`, no daemon |
| Agent channel | vsock over CH's Unix-socket `CONNECT` protocol | `VZVirtioSocketDevice` (in-process API, needs an adapter) |
| CoW runtime disks | `FICLONE` reflink on XFS/Btrfs | APFS `clonefile(2)` |
| NIC, L2 switch, wake-on-packet | TAP + eBPF switch / bridge | `VZFileHandleNetworkDeviceAttachment` + a userspace switch in fastvmd |
| Egress allowlist, published ports | nftables | userspace network stack (e.g. gVisor netstack via gvisor-tap-vsock) |
| Isolation | jailer (per-sandbox UID, cgroup, Landlock) | VZ's own process sandbox; no equivalent jailer at first |

### Proposed architecture

- **A per-sandbox helper process, `fastvm-vz`**, rather than VZ inside fastvmd.
  - It hosts one `VZVirtualMachine`, using cgo bindings such as
    [`Code-Hex/vz`](https://github.com/Code-Hex/vz) or a small Swift binary.
  - It exposes a Unix-socket control API like Cloud Hypervisor's.
  - It bridges VZ vsock to the same `CONNECT <port>` socket protocol, so
    `internal/agent` is unchanged.
  - This keeps the current "one VMM process per sandbox" model (`Wait`, `Stop`,
    crash isolation), keeps cgo and the `com.apple.security.virtualization`
    entitlement out of the daemon, and lets fastvmd stay pure Go.
  - The helper must be codesigned with that entitlement; ad-hoc signing is
    enough for local builds.
- **Userspace networking.** Each VM's NIC is one end of a datagram socketpair,
  and fastvmd holds the other end.
  - fastvmd becomes the L2 switch. Wake-on-network falls out naturally: a frame
    arriving for a paused VM is seen by fastvmd, which resumes the VM and then
    delivers the frame, preserving the "no frame is lost" contract of
    [DESIGN.md §5.5](DESIGN.md).
  - NAT, DNS, `--allow-host`, and `--publish` move into a userspace stack.
    Published ports then become real listening sockets on the Mac.
- **Build tags.**
  - Split Linux-only code into `_linux.go` / `_darwin.go`: network, switch, the
    volume clone, the jailer, and TAP handling in the daemon.
  - Add `internal/vmm/vz` and `internal/network/userspace`.
  - Select the backend from config (`vmm.backend: cloud-hypervisor | vz`).

### Open questions (spike first)

These need a short spike in `fastvm-vz` before any refactor:

1. **Save/restore with devices attached.** Does `saveMachineStateTo` work with
   virtio-fs, vsock, and file-handle network devices attached? If not, dormant
   needs another design (for example, detaching shares first).
2. **Clone semantics.** Can one saved state be restored into several
   independent VMs (with a different MAC and vsock CID each), as
   `snapshot restore` needs?
3. **Wake latency.** VZ restores all memory up front instead of demand-paging
   the memory file as Cloud Hypervisor does. Measure dormant → running for
   512 MB to 4 GB guests.
4. **Boot time** against the 0.6 s agent-ready target.
5. **Idle metrics.** Find replacements for the per-VM CPU, RSS, and I/O counters
   behind the idle predicate. Candidates: helper process `rusage`, and network
   counters from the userspace switch.

### Phase 1 changes that also help Phase 2

These landed with Phase 1 and are not Lima-specific:

- `fastvmctl` builds and runs natively on macOS (`make build-cli`). Guest-only
  agent server code is now `linux`-tagged, and terminal ioctls are per-OS.
- The guest kernel cmdline is arch-aware (`vmm.BaseCmdline`): `ttyAMA0` on
  arm64, `ttyS0` on x86_64.
- `make assets` takes `FASTVM_ARCH=arm64`.
