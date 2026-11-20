# TODO

Longer-term ideas and research items. Check items off as they land.

## Hardware & display

- [ ] **GPU passthrough**
  - Expose host GPUs to Cloud Hypervisor sandboxes via VFIO.
  - Cover IOMMU groups, host driver binding, guest drivers, and reset/recovery.
  - Decide resource model: whole GPU, MIG slice, or vGPU; how to schedule/claim GPUs per sandbox.
  - Add GPU capability reporting to `fastvmd`/`fastvmctl`.

- [ ] **VNC / graphical console**
  - Use Cloud Hypervisor's VNC support (or virtio-gpu + a display path) instead of exec-only access.
  - Decide auth model (loopback-only? per-sandbox token? SSH tunnel?) and clipboard/security policy.
  - Wire it into the web console or expose a local port through the CLI.

## Secrets

- [ ] **Secret injection and proxying**
  - Define the threat model: secrets must not leak into command lines, environment metadata, disk images, or snapshot bundles.
  - Options to compare:
    - agent-mediated injection into a tmpfs/secure path at runtime
    - per-sandbox secret proxy with short-lived credentials
    - egress proxy / eBPF-assisted credential injection for APIs
  - Add rotation, scoping to a sandbox, and redaction in logs/events.

## Declarative sandbox config

- [x] **Per-sandbox config file (e.g. `codex.fvmfile`)**
  - Strict YAML format with image, command, env (host `${VAR}` expansion), volumes, ports, network/allow-hosts, resources, and `no_auto_sleep`.
  - `fastvmctl run -f <file>`; documented in `docs/FVMFILE.md`.
  - Added examples: `hack/hello.fvmfile`, `hack/codex.fvmfile`, `hack/claude.fvmfile`, `hack/copilot.fvmfile`, `hack/nodejs.fvmfile`.
  - Coding-agent examples use `node:26-slim`; compressed layer blobs are shared across image pulls.
  - `template` subcommand and `hack/templates` removed; examples live in `hack/*.fvmfile`.
  - Added `user_data` / `user_data_file` cloud-init-style first-boot scripts.
  - Added `hack/docker.fvmfile` (Docker-in-VM); validate it against a host that can pull `docker:27-dind`.

## Ecosystem

- [ ] **containerd / Kubernetes shim**
  - Investigate a containerd runtime shim v2 backed by fastvm sandboxes.
  - Map pod lifecycle, CNI networking, volumes, and logs onto fastvm primitives.
  - Consider snapshot/restore integration and whether a CRI implementation is warranted.
  - Start with a prototype shim before committing to a Kubernetes integration.
