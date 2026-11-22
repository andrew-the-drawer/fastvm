# Snapshot clones and randomness

When several sandboxes are restored from one memory snapshot, they all resume
from the same bytes of guest RAM. That includes the state of every random
number generator in the guest. This document explains what that means, which
layers fastvm and Cloud Hypervisor reseed, and which they cannot.

## TL;DR

| Layer | Example | Reseeded after restore? |
|---|---|---|
| Guest kernel CRNG | `/dev/urandom`, `getrandom()` | **Yes.** Cloud Hypervisor's VM Generation ID device (CH ≥ v54, guest `CONFIG_VMGENID`), plus fastvm's agent reseed as a fallback |
| Kernel secrets picked once at boot | SipHash keys (e.g. for TCP sequence numbers and SYN cookies), already-chosen ASLR layouts and stack canaries of running processes | **No.** They stay identical across clones |
| Userspace PRNG state | language runtime RNGs, crypto-library DRBG caches, shell `$RANDOM`, pre-generated tokens and UUID pools | **No.** The application must draw fresh randomness after a restore |
| Identity on disk | `/etc/machine-id`, SSH host keys | **No.** `disk.img` is copied verbatim. Hostname and IP *are* rewritten by fastvm |

If clones of a snapshot must not share secrets, create the snapshot **before**
generating secrets (keys, tokens, session state), or regenerate them after
restore.

## Why clones share RNG state

A snapshot is a copy of guest memory plus vCPU and device state. A CSPRNG is
only an internal state (a key plus counters) that lives in that memory. It
returns a fixed sequence for a given state. That is the property that makes it
*pseudo*random. So:

```
            snapshot (RNG state S)
              /                 \
   restore → clone A        restore → clone B
   next draw = f(S)         next draw = f(S)      ← same bytes
```

The source sandbox resumes from `S` too (`fastvmctl snapshot` pauses it,
captures, then resumes), so it shares state with every clone, not just the
clones with each other.

Why this is serious rather than cosmetic:

- **Nonce reuse breaks signatures.** ECDSA/DSA require a fresh secret nonce `k`
  per signature. Two signatures over different messages with the same `k` let
  anyone solve for the private key. Two clones signing different requests
  with the same RNG state do exactly that.
- **Identical "unique" values.** Session IDs, CSRF tokens, UUIDv4s, TLS
  ephemeral keys, and temp file names can collide across clones.
- **No ASLR diversity across clones.** Every running process keeps the address
  layout it had at snapshot time. An address leaked from one clone is valid in
  all of them.

## Layer 1: the kernel CRNG

### VM Generation ID (the VMM does it)

VMGenID is a small virtual device, originally specified by Microsoft and now
also implemented by QEMU, Firecracker and Cloud Hypervisor. It exposes a 128-bit
value in guest memory, reachable through ACPI. On every restore the VMM writes a
new random value and sends the guest an ACPI notification (on Cloud Hypervisor,
through the Generic Event Device (GED) interrupt). Linux's `vmgenid` driver
(`CONFIG_VMGENID`, Linux ≥ 5.18) reacts by calling `add_vmfork_randomness()`,
which mixes in the new value and forces an immediate CRNG reseed.

In Cloud Hypervisor:

- Added in **v54.0** (release notes: "VM Generation ID Device"). It is always
  present and needs no flag.
- `DeviceManager::regenerate_vmgenid()` (`vmm/src/device_manager.rs`) is
  called on the restore path from `vmm/src/vm.rs`. It writes the new ID and
  raises `AcpiNotificationFlags::VMGENID_CHANGED`.
- On x86_64 direct kernel boot (what fastvm does), the guest finds the ACPI
  tables through the legacy memory scan, so nothing needs to be on the cmdline.

fastvm's pinned guest kernel (`ch-release-v7.2.8-20261009`, see
`test/e2e/fetch-assets.sh`) has the driver built in:

```sh
$ strings vmlinux.bin | grep -E 'vmgenid_plaform_driver|VMGENCTR'
VMGENCTR
vmgenid_plaform_driver
```

(`plaform` is the kernel's own spelling of the symbol. The presence of an
`__initcall__kmod_vmgenid…` symbol means the driver is built in, not a module.)

So on the supported stack, CH ≥ v54 plus the pinned kernel, the guest kernel
already reseeds itself on every restore. That includes fastvm's own
dormant/wake cycle, which is also a restore (harmless there: one VM, one
reseed).

### The agent reseed (fastvm does it)

VMGenID depends on two things fastvm does not control or check:

1. **The Cloud Hypervisor version.** The docs say v54+, but `fastvmd` does
   not verify it. An older `cloud-hypervisor` binary has no VMGenID device.
2. **The guest kernel.** `kernel_path` is configurable. A custom kernel
   without `CONFIG_VMGENID` silently ignores the device.

In either case clones keep identical kernel RNG state with no error. As
defense in depth, the daemon now also reseeds every restored guest through the
agent:

```
fastvmd (createFromSnapshot → restoreLocked)
  │  CH --restore, resume vCPUs
  │  dial agent over vsock, WaitReady
  │  OpReseed {data: 32 bytes from host crypto/rand}      ← new
  │  OpHostname, OpNetwork                                  (existing)
  ▼
fastvm-agent (PID 1 in the guest)
     ioctl(/dev/urandom, RNDADDENTROPY, seed)   mix + credit the bytes
     ioctl(/dev/urandom, RNDRESEEDCRNG)         fold them into the CRNG now
```

Both ioctls are needed. Since the Linux 5.18 RNG rewrite, input added to an
already-initialized kernel lands in the *input pool*. The CRNG only pulls from
that pool on its reseed schedule (up to a minute). `RNDRESEEDCRNG` forces the
pull, so the very next `getrandom()` depends on the new bytes.

The daemon records the outcome as a sandbox event (`fastvmctl events`):

- `state: guest RNG reseeded after restore`, or
- `warning: guest RNG not reseeded by agent after restore (relying on VMGenID): …`

A failed reseed is **not fatal**, for an instructive reason. After a restore,
the agent that answers is the binary captured in the snapshot's memory, not the
one currently on the host. A snapshot taken before this change holds an agent
that does not know `OpReseed` and replies `unknown op "reseed"`. Failing those
restores would break existing snapshots that are still safe under VMGenID.

### The remaining window

Neither mechanism is instantaneous. fastvm restores with `Resume: true`, so
guest code runs before the ACPI notification is handled and before the agent
request arrives. Anything that draws randomness in those first milliseconds
uses the cloned state. Closing that window would need the guest to block RNG
consumers until the reseed lands. That is a VMM/kernel-level design (it is why
VMGenID is an interrupt and not a polled value), not something the daemon can
do from outside.

## Layers 2–4: what no host-side mechanism fixes

VMGenID and the agent reseed change **future** kernel RNG output. They cannot
touch state that has already been derived from the RNG and copied out into
other memory:

- **Kernel one-time secrets.** Keys the kernel generates once and caches
  (e.g. `net_get_random_once` SipHash keys used for TCP sequence numbers and
  SYN cookies) are not regenerated.
- **Userspace generators.** A process that seeded its own PRNG at startup
  carries that seed into every clone. Cloud Hypervisor's own docs call this
  out: "Such a program has to draw fresh randomness itself after the restore."
  Crypto libraries that cache a DRBG often reseed on `fork()` or on a timer.
  A VM clone is neither, so the process cannot tell.
- **Disk identity.** `disk.img` is copied verbatim, so `/etc/machine-id` and
  any SSH host keys or generated certificates are shared. fastvm rewrites the
  hostname (`OpHostname`) and network (`OpNetwork`) only.

`TestSnapshotClonesDivergeRNG` demonstrates the userspace case with a
long-lived busybox shell: its `$RANDOM` sequence repeats exactly in both
clones, even though `/dev/urandom` diverges.

## Try it yourself

On a Linux/KVM host with fastvm built from this branch:

```sh
# 1. Check the stack: CH version and the guest kernel's driver.
cloud-hypervisor --version                       # want v54+
strings /path/to/vmlinux | grep vmgenid_plaform_driver

# 2. A one-vCPU parent (one CPU keeps per-CPU RNG selection deterministic).
fastvmctl run -d --image alpine --vcpus 1 --name parent -- sh -c 'sleep infinity'
snap=$(fastvmctl snapshot parent)
fastvmctl run --from-snapshot "$snap" --name a
fastvmctl run --from-snapshot "$snap" --name b

# 3. Kernel RNG: should differ between a and b.
for s in a b; do
  fastvmctl exec $s -- sh -c 'head -c 16 /dev/urandom | od -An -tx1'
done

# 4. Did VMGenID fire? The GED interrupt count in a clone is higher than in the parent.
for s in parent a; do fastvmctl exec $s -- grep ACPI:Ged /proc/interrupts; done
fastvmctl exec a -- ls /sys/bus/platform/drivers/vmgenid

# 5. Did the agent reseed?
fastvmctl events -n 50 | grep -i 'rng'

fastvmctl rm a b parent; fastvmctl snapshot rm "$snap"
```

To *see* the failure mode, take away both mechanisms: boot with a kernel built
without `CONFIG_VMGENID` and a snapshot whose agent predates `OpReseed`. Step 3
then tends to print identical bytes. "Tends to" because the kernel's own
time-based reseed can still kick in after the clock jumps on restore. It mixes
in whatever interrupt timing the clones have collected since resuming, which is
divergence by luck, not by design.

The automated version (needs root, `/dev/kvm`, and `make assets`):

```sh
FASTVM_E2E=1 go test -count=1 -v -run TestSnapshotClonesDivergeRNG ./test/e2e/
```

It asserts that the clones' `/dev/urandom` output differs and that the agent
reseed succeeded in each clone. It logs the GED counts and the userspace
`$RANDOM` values. It cannot tell *which* mechanism produced the divergence: on
the supported stack both run.

## Related observations (not changed here)

- **The boot seed is on the kernel cmdline.** `fastvm.seed=<hex>` is credited
  as full entropy at boot, but `/proc/cmdline` is readable by every user in the
  guest. Kernels also mix in RDRAND/RDSEED and timing, so this is not a
  practical break, but delivering the boot seed over vsock (as `OpReseed` does)
  would keep it private.
- **Patching `payload.cmdline` in the snapshot's `config.json` does not change
  the restored guest's `/proc/cmdline`.** That string lives in guest kernel
  memory. The hostname is actually changed by the agent's `OpHostname`, and
  the copied cmdline still carries the parent's `fastvm.seed`.

## Possible follow-ups

- Have `fastvmd` check `cloud-hypervisor --version` at startup and warn below v54.
- Regenerate `/etc/machine-id` on restore when it exists.
- Let workloads opt in to a restore hook (e.g. `/etc/fastvm/restore.d/*`),
  run by the agent after the reseed, to rotate their own secrets.

## References

- Cloud Hypervisor, [snapshot/restore: VM Generation ID](https://github.com/cloud-hypervisor/cloud-hypervisor/blob/main/docs/snapshot_restore.md#vm-generation-id) and the v54.0 release notes
- Linux `drivers/virt/vmgenid.c` and `drivers/char/random.c` (`add_vmfork_randomness`, `RNDRESEEDCRNG`)
- [UAPI group: VMGenID specification](https://uapi-group.org/specifications/specs/vmgenid/)
- [QEMU: Virtual Machine Generation ID device](https://qemu.readthedocs.io/en/master/specs/vmgenid.html)
- Firecracker, `docs/snapshotting/random-for-clones.md`
