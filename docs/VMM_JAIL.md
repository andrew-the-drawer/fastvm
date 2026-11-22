# VMM jail (experimental, step 1)

> Status: **sketch / proof of concept.** The jail setup is covered by unit tests
> and by a privileged "hostile VMM" test that runs without KVM. Booting a real
> Cloud Hypervisor guest under the jail has **not** been verified yet; see
> [What still needs a KVM host](#what-still-needs-a-kvm-host).

## Why: the second wall

A sandbox has two walls between untrusted guest code and the host:

```
 host
 └── cloud-hypervisor process (VMM)     ← wall 2: what can this process reach?
     └── guest VM (KVM)                 ← wall 1: hardware virtualization
         └── untrusted code
```

The guest cannot do I/O by itself. Every disk read, network frame and vsock
message is emulated by the `cloud-hypervisor` process, which parses
guest-controlled data. A bug there (in virtio-net or virtio-block, say) can
let a guest take over the VMM process. That is what a "VM escape" usually
means in practice.

Without the jail, fastvmd starts that process as **root**, with all
capabilities, in the host's filesystem, process and network view. Taking over
the VMM is taking over the host, including every other sandbox's disk and
memory snapshots. The hostile-VMM test below measures exactly that.

## What the jail does

Enable it with:

```yaml
vmm:
  jail:
    enabled: true
    uid_base: 1900000000     # UID/GID range reserved for VMM processes
    uid_count: 65536
    cgroup_root: /sys/fs/cgroup/fastvm-vmm
    memory_overhead_mb: 256  # memory.max = guest RAM + this
    pids_max: 512
```

For every VMM launch the root daemon does the privileged work, then starts
`cloud-hypervisor` with nothing left to abuse:

| Step | Mechanism | What a compromised VMM loses |
|---|---|---|
| Per-sandbox UID/GID | `setuid`/`setgid` at exec (`SysProcAttr.Credential`), plus the `/dev/kvm` group | Root. Other sandboxes' files belong to other UIDs |
| No capabilities | Automatic: going from UID 0 to non-zero clears the capability sets | `CAP_NET_ADMIN`, `CAP_SYS_ADMIN`, `CAP_DAC_OVERRIDE`, … |
| Own files only | The daemon `chown`s the sandbox dir and its disk to the jail UID; directories above get `o+x` (traverse) but not `o+r` (list) | Reading root-only daemon state or other sandboxes' disks |
| TAP as a file descriptor | The daemon opens the TAP and passes it as fd 3 (`--net fd=[3]`, or `external_fds=[net(<id>)@[3]]` on restore) | The need for `CAP_NET_ADMIN` (see below) |
| TAP owner | `TUNSETOWNER` = jail UID | Attaching to another sandbox's TAP |
| cgroup v2 | One cgroup per sandbox with `memory.max` and `pids.max`; the VMM is *cloned into it* (`CLONE_INTO_CGROUP`) | Exhausting host memory or forking without limit, with no window where it runs outside the cgroup |
| Landlock | `--landlock` plus a rule for the sandbox dir. CH adds rules for its disk, kernel, serial and sockets | Opening any other path, even world-readable ones (applied by CH after VM creation) |
| seccomp | Already on by default in Cloud Hypervisor | Unexpected syscalls |

The code is in `internal/vmm/cloudhypervisor/jail.go` (portable logic) and
`jail_linux.go` (cgroup, TUN ioctls, credentials). The driver hooks it into
`Boot`, `Restore`, `Snapshot` and `Stop`.

### Two non-obvious problems, and how they were found

**1. Cloud Hypervisor cannot open a TAP by name without root.** Reading
`net_util/src/open_tap.rs`: when given `tap=<name>`, CH always calls
`tap.enable()`, which is `SIOCSIFFLAGS`, and the kernel requires
`CAP_NET_ADMIN` for that even if the interface is already up. So simply
dropping privileges would break networking. With `fd=`, CH uses
`Tap::from_file` and never calls `enable()`.

On restore, CH prefers a saved `tap` name over passed FDs
(`device_manager.rs`: `if let Some(ref tap_if_name) = net_cfg.tap { … } else if
let Some(fds) = …`). So the jail also rewrites the snapshot's `config.json` to
drop `net[].tap` before restoring.

**2. Unowned persistent TAPs can be attached by anyone.** fastvm creates TAPs
with `TUNSETPERSIST` and no owner. The kernel's `tun_not_capable()` only
refuses an attach if an owner or group *is set* and doesn't match. So an
unprivileged process can attach to any free TAP. That means a jailed but
compromised VMM A could grab sandbox B's TAP whenever B's VMM isn't holding
it, for example during a dormant transition. The jail sets `TUNSETOWNER` to
the sandbox's UID when it attaches. The hostile-VMM test shows both sides: the
owned TAP is `denied`, an unowned one is `ok`.

### Snapshots

The VMM can only write in its own sandbox directory. Snapshots into
`<sandbox>/memory` (dormant offload) work directly. `fastvmctl snapshot`
exports to `<data_dir>/snapshots/<name>`: the VMM writes into a staging
directory inside its home, and the daemon moves the files and gives them back
to root.

The Landlock rule is saved in the snapshot's `config.json`, and CH re-applies
it on restore. A clone is restored into a *new* sandbox directory, so the jail
rewrites that rule to the new path as well.

## See it: the hostile-VMM test

`TestJailHostileVMM` prepares a real jail (UIDs, chown, cgroup, owned TAP) for
two sandboxes. It then launches a helper in place of `cloud-hypervisor` that
behaves like a compromised VMM and reports what it can reach. It runs the same
helper once more the way fastvmd launches CH without the jail. It needs root,
cgroup v2 and `/dev/net/tun`, but no KVM:

```sh
sudo FASTVM_JAIL_TESTS=1 go test -count=1 -v -run TestJailHostileVMM ./internal/vmm/cloudhypervisor/
```

Inside Docker (e.g. on a Mac), use a privileged container. First move the
shell out of the container's root cgroup: cgroup v2 forbids delegating
controllers from a cgroup that still contains processes.

```sh
docker run --rm --privileged -v "$PWD":/src -w /src golang:1.27.3 sh -c '
  mkdir -p /sys/fs/cgroup/init
  for p in $(cat /sys/fs/cgroup/cgroup.procs); do echo $p > /sys/fs/cgroup/init/cgroup.procs; done
  FASTVM_JAIL_TESTS=1 go test -count=1 -v -run TestJailHostileVMM ./internal/vmm/cloudhypervisor/'
```

Result (abridged):

| Check | Without jail (today) | Jailed |
|---|---|---|
| uid | `0` | `1900000001` |
| effective capabilities | `000001ffffffffff` (all) | `0000000000000000` |
| read another sandbox's disk | ok | **denied** |
| write another sandbox's dir | ok | **denied** |
| read root-only daemon state | ok | **denied** |
| read `/etc/shadow` | ok | **denied** |
| list the data dir | ok | **denied** (can still traverse to its own files) |
| attach another sandbox's TAP | ok | **denied** |
| signal root processes | ok | **denied** |
| own cgroup with memory/pids limits | no | yes (`/sbA`) |
| read `/etc/passwd`, `/proc/1/cmdline` | ok | ok: still possible (see below) |

## Known gaps (step 1)

- **Still sees the host.** The VMM can read world-readable files until
  Landlock applies (Landlock is untested here), it can see every host process
  in `/proc`, and it can open network sockets to anything the host can reach,
  including services on `127.0.0.1` and abstract UNIX sockets. Step 2 closes
  this with namespaces: mount namespace + `pivot_root` into a directory with
  only the VMM's files, a PID namespace, and a network namespace holding only
  the TAP.
- **virtiofsd is not jailed.** It still runs as root, with `--sandbox=namespace`.
  The jail only `chown`s its socket so the jailed VMM can connect.
- **TAP owner is set at the first jailed launch, not at TAP creation.** There
  is a short window after the network manager creates the TAP. Setting the
  owner in `internal/network` would remove it.
- **UID allocation is in memory.** After a daemon restart UIDs are handed out
  again, and launches re-`chown` the files they need. Stale files of dead
  sandboxes may still carry a UID that is reused later.
- **The kernel must be world-readable** (`o+r`, with traversable parents).
  The demo config's `test/e2e/assets/vmlinux.bin` inside a home directory
  usually is not, so copy it somewhere like `/var/lib/fastvm/`.

## What still needs a KVM host

On a Linux/KVM host with `vmm.jail.enabled: true`, verify:

1. `fastvmctl run --image alpine -- uname -a` boots and prints.
   `ps -o user,pid,cmd -C cloud-hypervisor` shows a `19000000xx` user, and
   `cat /proc/<pid>/cgroup` shows `fastvm-vmm/<id>`.
2. `fastvmctl exec`, `pause`, `resume`, `pause --deep` (dormant), and a wake.
3. `fastvmctl snapshot` plus `run --from-snapshot` (staging move, restore with
   `external_fds`, Landlock rule rewrite).
4. Networking: `--net` and published ports (TAP passed as an FD).
5. Host volumes (`--volume`): CH connecting to root's virtiofsd socket.
6. Landlock is active: `grep -i landlock <data_dir>/run/vmm.log`, or the CH
   process failing to open a path outside its rules.

## References

- Firecracker [jailer](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md): the design this is modeled on
- Cloud Hypervisor `docs/landlock.md`, `docs/seccomp.md`, `net_util/src/open_tap.rs`, `vmm/src/device_manager.rs`
- Linux `drivers/net/tun.c` (`tun_not_capable`, `TUNSETOWNER`), cgroup v2 docs ("no internal process" rule, `CLONE_INTO_CGROUP`), `landlock(7)`, `capabilities(7)` (effects of UID changes on capabilities)
