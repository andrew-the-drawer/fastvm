package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"fastvm/internal/manager"
	"fastvm/internal/types"
)

// writeSnapshotFixture lays out a managed snapshot the way snapshotLocked
// does: snapshot.json, disk.img, and the Cloud Hypervisor snapshot/config.json.
func writeSnapshotFixture(t *testing.T, h *harness, name string) {
	t.Helper()
	dir := filepath.Join(h.d.snapshotsRoot(), name)
	if err := os.MkdirAll(filepath.Join(dir, "snapshot"), 0o700); err != nil {
		t.Fatal(err)
	}
	meta, _ := json.Marshal(SnapshotMeta{
		Version: snapshotVersion, ImageDigest: "sha256:abc",
		VCPUs: 1, MemoryMB: 256, NetworkEnabled: false,
	})
	chCfg, _ := json.Marshal(map[string]any{
		"payload": map[string]any{"cmdline": "console=ttyS0 fastvm.hostname=old"},
		"disks":   []any{map[string]any{"path": "/old/disk.img"}},
		"vsock":   map[string]any{"socket": "/old/vsock.sock"},
		"serial":  map[string]any{"file": "/old/serial.log"},
	})
	for path, data := range map[string][]byte{
		filepath.Join(dir, "snapshot.json"):           meta,
		filepath.Join(dir, "disk.img"):                []byte("disk"),
		filepath.Join(dir, "snapshot", "config.json"): chCfg,
	} {
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func (h *harness) restoreClone(t *testing.T, snap, name string) (types.Sandbox, *fakeAgent) {
	t.Helper()
	sb, err := h.d.Create(context.Background(), manager.CreateOptions{Name: name, FromSnapshot: snap})
	if err != nil {
		t.Fatalf("restore %s: %v", name, err)
	}
	return sb, h.dial.last()
}

// Restoring the same snapshot twice must hand each clone its own fresh,
// non-zero reseed so the clones' kernel RNGs diverge.
func TestRestoreFromSnapshotReseedsEachClone(t *testing.T) {
	h := newHarness(t)
	writeSnapshotFixture(t, h, "base")

	_, a1 := h.restoreClone(t, "base", "clone-1")
	_, a2 := h.restoreClone(t, "base", "clone-2")
	if a1 == a2 {
		t.Fatal("expected a separate agent connection per clone")
	}

	for i, a := range []*fakeAgent{a1, a2} {
		a.mu.Lock()
		n := len(a.reseeds)
		a.mu.Unlock()
		if n != 1 {
			t.Fatalf("clone-%d: reseeds = %d, want 1", i+1, n)
		}
	}
	s1, s2 := a1.reseeds[0], a2.reseeds[0]
	if len(s1) != reseedBytes || len(s2) != reseedBytes {
		t.Fatalf("seed lengths = %d, %d; want %d", len(s1), len(s2), reseedBytes)
	}
	if bytes.Equal(s1, make([]byte, reseedBytes)) {
		t.Fatal("seed is all zeros")
	}
	if bytes.Equal(s1, s2) {
		t.Fatal("two clones received the same reseed bytes")
	}
}

// An agent captured in an older snapshot does not know OpReseed. The restore
// must still succeed, and the missing reseed must be visible as a warning.
func TestRestoreFromSnapshotToleratesReseedFailure(t *testing.T) {
	h := newHarness(t)
	writeSnapshotFixture(t, h, "base")
	h.dial.mu.Lock()
	h.dial.next = func(a *fakeAgent) { a.reseedErr = errors.New(`agent: reseed: unknown op "reseed"`) }
	h.dial.mu.Unlock()

	sb, _ := h.restoreClone(t, "base", "old-agent")
	if sb.State != types.StateRunning {
		t.Fatalf("state = %s, want running", sb.State)
	}
	events, err := h.d.Events(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, ev := range events {
		if ev.SandboxID == sb.ID && ev.Type == "warning" && strings.Contains(ev.Message, "not reseeded") {
			return
		}
	}
	t.Fatalf("no reseed warning event in %+v", events)
}
