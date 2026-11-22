package e2e

import (
	"context"
	"strings"
	"testing"
	"time"

	"fastvm/internal/image"
	"fastvm/internal/manager"
	"fastvm/internal/types"
)

// rngWorkload is a long-lived shell whose userspace PRNG ($RANDOM) is seeded
// once at startup and therefore captured in the snapshot. Each request on
// /tmp/rng.req is answered with three draws on /tmp/rng.resp. The FIFOs make
// the exchange synchronous: the reply is read only after the shell writes it.
const rngWorkload = `mkfifo /tmp/rng.req /tmp/rng.resp
while :; do
  read _ < /tmp/rng.req
  echo "$RANDOM $RANDOM $RANDOM" > /tmp/rng.resp
done`

const rngAsk = `echo > /tmp/rng.req; cat /tmp/rng.resp`

// kernelDraw reads 32 bytes from the guest kernel CRNG, hex encoded.
const kernelDraw = `head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'`

// gedCount sums ACPI Generic Event Device interrupts. Cloud Hypervisor raises
// one when it changes the VM Generation ID on restore (same probe as CH's own
// test_snapshot_restore_vmgenid).
const gedCount = `grep 'ACPI:Ged' /proc/interrupts | awk '{s=0; for(i=2;i<=NF;i++) if($i~/^[0-9]+$/) s+=$i; print s}'`

// TestSnapshotClonesDivergeRNG restores two sandboxes from one memory snapshot
// and checks that their kernel RNG outputs differ. Without a reseed both
// clones resume with an identical CRNG state. See docs/SNAPSHOT_RNG.md.
//
// It also logs (but does not assert) two observations the write-up relies on:
// whether the VMGenID notification fired in the clone, and that a userspace
// PRNG seeded before the snapshot still repeats across clones; no host-side
// mechanism can reseed process memory.
func TestSnapshotClonesDivergeRNG(t *testing.T) {
	kernel, rootfs := requireE2E(t)
	s := newStack(t, kernel)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	base, err := s.images.Ingest(ctx, image.IngestSpec{RootfsDir: rootfs, Tag: "alpine:e2e"})
	if err != nil {
		t.Fatalf("ingest base disk: %v", err)
	}
	// One vCPU keeps the guest's per-CPU CRNG selection deterministic, so
	// matching state really does mean matching output.
	parent, err := s.d.Create(ctx, manager.CreateOptions{
		Name: "rng-parent", Image: base.Identity(), VCPUs: 1, NoAutoSleep: true,
		Cmd: []string{"/bin/sh", "-c", rngWorkload},
	})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	defer func() { _ = s.d.Delete(context.Background(), parent.ID) }()

	exec := func(id, script string) string {
		t.Helper()
		resp, err := s.d.Exec(ctx, id, []string{"/bin/sh", "-c", script}, nil)
		if err != nil {
			t.Fatalf("exec %q in %s: %v", script, id, err)
		}
		return strings.TrimSpace(resp.Stdout)
	}

	// Wait for the workload's FIFOs, then exercise it once so the shell is
	// definitely parked in `read` when the snapshot is taken.
	waitFor(t, time.Minute, func() bool { return exec(parent.ID, "test -p /tmp/rng.resp && echo ok") == "ok" })
	t.Logf("parent before snapshot: $RANDOM=%q", exec(parent.ID, rngAsk))
	parentGED := exec(parent.ID, gedCount)

	if _, err := s.d.Snapshot(ctx, parent.ID, "rng-e2e"); err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	type observation struct{ id, kernel, user, ged string }
	clones := make([]observation, 2)
	for i := range clones {
		sb, err := s.d.Create(ctx, manager.CreateOptions{
			Name: []string{"rng-clone-a", "rng-clone-b"}[i], FromSnapshot: "rng-e2e",
		})
		if err != nil {
			t.Fatalf("restore clone %d: %v", i, err)
		}
		defer func() { _ = s.d.Delete(context.Background(), sb.ID) }()
		if sb.State != types.StateRunning {
			t.Fatalf("clone %d state = %s", i, sb.State)
		}
		clones[i] = observation{
			id:     sb.ID,
			kernel: exec(sb.ID, kernelDraw),
			user:   exec(sb.ID, rngAsk),
			ged:    exec(sb.ID, gedCount),
		}
		t.Logf("clone %d: urandom=%s $RANDOM=%q ACPI:Ged=%s (parent before snapshot: %s)",
			i, clones[i].kernel, clones[i].user, clones[i].ged, parentGED)
	}

	// The property under test: the kernel CRNG of the two clones diverged.
	if len(clones[0].kernel) != 64 {
		t.Fatalf("unexpected urandom output %q", clones[0].kernel)
	}
	if clones[0].kernel == clones[1].kernel {
		t.Fatalf("clones produced identical /dev/urandom output %s: kernel RNG state was not reseeded after restore", clones[0].kernel)
	}

	// The agent-side reseed must have run in each clone (and succeeded with a
	// real kernel: RNDADDENTROPY + RNDRESEEDCRNG).
	events, err := s.d.Events(ctx, 500)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	for i, c := range clones {
		found := false
		for _, ev := range events {
			if ev.SandboxID == c.id && strings.Contains(ev.Message, "guest RNG reseeded after restore") {
				found = true
			}
			if ev.SandboxID == c.id && ev.Type == "warning" && strings.Contains(ev.Message, "not reseeded") {
				t.Errorf("clone %d: %s", i, ev.Message)
			}
		}
		if !found {
			t.Errorf("clone %d: no reseed event recorded", i)
		}
	}

	// Documented limitation, logged rather than asserted: state that lives in
	// process memory (here the shell's $RANDOM generator) is cloned verbatim.
	if clones[0].user != "" && clones[0].user == clones[1].user {
		t.Logf("as expected, userspace PRNG repeated across clones (%q); see docs/SNAPSHOT_RNG.md", clones[0].user)
	} else {
		t.Logf("userspace PRNG differed across clones (%q vs %q)", clones[0].user, clones[1].user)
	}
}
