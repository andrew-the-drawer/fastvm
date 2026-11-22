package cloudhypervisor

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"fastvm/internal/vmm"
)

func TestJailBootArgsPassTAPAsFDAndEnableLandlock(t *testing.T) {
	cfg := vmm.BootConfig{
		KernelPath: "/k", DiskPath: "/data/volumes/sb.img",
		TAPName: "tap-1", MAC: "02:00:00:00:00:01",
		APISocket: "/data/sandboxes/sb/vmm-api.sock", SerialPath: "/data/sandboxes/sb/serial.log",
	}
	paths := vmPaths{apiSock: cfg.APISocket, serial: cfg.SerialPath}
	args := jailBootArgs(bootArgs(cfg, paths, nil), "/data/sandboxes/sb")
	joined := strings.Join(args, "\n")

	for _, want := range []string{
		"--net\nfd=[3],mac=02:00:00:00:00:01",
		"--landlock",
		"--landlock-rules\npath=/data/sandboxes/sb,access=rw",
		"--disk\npath=/data/volumes/sb.img,image_type=raw",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("jailed args missing %q:\n%s", want, joined)
		}
	}
	if strings.Contains(joined, "tap=") {
		t.Errorf("jailed args must not open the TAP by name:\n%s", joined)
	}
}

func TestPatchSnapshotForJail(t *testing.T) {
	dir := t.TempDir()
	in := map[string]any{
		"disks":  []any{map[string]any{"path": "/data/volumes/clone.img"}},
		"net":    []any{map[string]any{"id": "_net2", "tap": "tap-old", "mac": "02:00:00:00:00:09"}},
		"memory": map[string]any{"size": float64(512 << 20)},
		// A clone restored into a new sandbox dir must not keep the parent's.
		"landlock_enable": true,
		"landlock_rules":  []any{map[string]any{"path": "/data/sandboxes/parent", "access": "rw"}},
	}
	data, _ := json.Marshal(in)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}

	info, err := patchSnapshotForJail(dir, "/data/sandboxes/clone")
	if err != nil {
		t.Fatal(err)
	}
	if len(info.DiskPaths) != 1 || info.DiskPaths[0] != "/data/volumes/clone.img" {
		t.Errorf("disks = %v", info.DiskPaths)
	}
	if len(info.NetIDs) != 1 || info.NetIDs[0] != "_net2" {
		t.Errorf("net ids = %v", info.NetIDs)
	}
	if info.MemoryBytes != 512<<20 {
		t.Errorf("memory = %d", info.MemoryBytes)
	}

	var out map[string]any
	data, _ = os.ReadFile(filepath.Join(dir, "config.json"))
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	netcfg := out["net"].([]any)[0].(map[string]any)
	if _, ok := netcfg["tap"]; ok {
		t.Error("tap name kept: CH would prefer it over the passed FD")
	}
	if netcfg["mac"] != "02:00:00:00:00:09" {
		t.Errorf("mac changed: %v", netcfg["mac"])
	}
	if out["landlock_enable"] != true {
		t.Error("landlock not enabled")
	}
	rule := out["landlock_rules"].([]any)[0].(map[string]any)
	if rule["path"] != "/data/sandboxes/clone" || rule["access"] != "rw" || len(out["landlock_rules"].([]any)) != 1 {
		t.Errorf("landlock rules = %v", out["landlock_rules"])
	}
}

func TestJailRestoreSource(t *testing.T) {
	got, err := jailRestoreSource("/s", []string{"_net2"})
	if err != nil || got != "source_url=file:///s,external_fds=[net(_net2)@[3]]" {
		t.Errorf("one NIC: %q, %v", got, err)
	}
	if got, err := jailRestoreSource("/s", nil); err != nil || got != "source_url=file:///s" {
		t.Errorf("no NIC: %q, %v", got, err)
	}
	if _, err := jailRestoreSource("/s", []string{"a", "b"}); err == nil {
		t.Error("two NICs should be rejected")
	}
}

func TestJailUIDPool(t *testing.T) {
	j := newJailState(JailOptions{UIDBase: 1000, UIDCount: 2})
	a, err := j.acquire("a")
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := j.acquire("a"); again != a {
		t.Errorf("same sandbox got %d then %d", a, again)
	}
	b, err := j.acquire("b")
	if err != nil || b == a {
		t.Fatalf("b = %d (a = %d), err %v", b, a, err)
	}
	if _, err := j.acquire("c"); err == nil {
		t.Fatal("expected exhaustion")
	}
	j.release("a")
	c, err := j.acquire("c")
	if err != nil || c != a {
		t.Fatalf("c = %d, want freed %d (err %v)", c, a, err)
	}
	if a < 1000 || a > 1001 || b < 1000 || b > 1001 {
		t.Errorf("UIDs outside range: %d %d", a, b)
	}
}

func TestEnsureTraversable(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "data")
	deep := filepath.Join(base, "sandboxes", "sb")
	if err := os.MkdirAll(deep, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{root, base, filepath.Join(base, "sandboxes"), deep} {
		_ = os.Chmod(d, 0o700)
	}

	if err := ensureTraversable(base, deep); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{base, filepath.Join(base, "sandboxes"), deep} {
		st, _ := os.Stat(d)
		if st.Mode().Perm() != 0o701 {
			t.Errorf("%s mode = %o, want 701 (traverse, not list)", d, st.Mode().Perm())
		}
	}
	if st, _ := os.Stat(root); st.Mode().Perm() != 0o700 {
		t.Errorf("directory above the data dir was modified: %o", st.Mode().Perm())
	}
	if err := ensureTraversable(base, root); err == nil {
		t.Error("expected an error for a path outside the data dir")
	}
}

func TestCheckJailPaths(t *testing.T) {
	d := &Driver{}
	p := vmPaths{apiSock: "/data/sandboxes/sb/vmm-api.sock", serial: "/data/sandboxes/sb/serial.log"}
	if err := d.checkJailPaths(p, "/data/sandboxes/sb/vsock.sock"); err != nil {
		t.Fatal(err)
	}
	p.serial = "/data/run/serial.log"
	if err := d.checkJailPaths(p, ""); err == nil {
		t.Error("serial log outside the sandbox dir should be rejected")
	}
}

// chownTree must change a planted symlink itself, never its target.
func TestChownTreeDoesNotFollowSymlinks(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("needs root (CAP_CHOWN)")
	}
	root := t.TempDir()
	outside := filepath.Join(root, "host-secret")
	home := filepath.Join(root, "home")
	if err := os.WriteFile(outside, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(home, "link")); err != nil {
		t.Fatal(err)
	}
	if err := chownTree(home, 4242, 4242); err != nil {
		t.Fatal(err)
	}
	owner := func(p string) uint32 {
		var st syscall.Stat_t
		if err := syscall.Lstat(p, &st); err != nil {
			t.Fatal(err)
		}
		return st.Uid
	}
	if owner(outside) != 0 {
		t.Fatal("chownTree followed a symlink out of the sandbox dir")
	}
	if owner(filepath.Join(home, "link")) != 4242 || owner(home) != 4242 {
		t.Error("sandbox files were not chowned")
	}
}
