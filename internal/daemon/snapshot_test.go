package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"fastvm/internal/types"
)

func TestPatchSnapshotConfigRewritesHostPaths(t *testing.T) {
	dir := t.TempDir()
	original := map[string]any{
		"payload": map[string]any{
			"kernel":  "/old/vmlinux",
			"cmdline": "console=ttyS0 fastvm.hostname=oldsandbox",
		},
		"disks":  []any{map[string]any{"id": "_disk0", "path": "/old/disk.img"}},
		"serial": map[string]any{"file": "/old/serial.log"},
		"vsock":  map[string]any{"cid": 5, "socket": "/old/vsock.sock"},
		"net":    []any{map[string]any{"tap": "tap-old", "mac": "76:aa:e6:74:54:45"}},
	}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	sb := &types.Sandbox{
		ID: "new-sandbox", VolumePath: "/new/disk.img",
		SerialPath: "/new/serial.log", VsockUDPath: "/new/vsock.sock",
		TAPName: "tap-new", MAC: "76:aa:00:00:00:01",
	}
	if err := patchSnapshotConfig(dir, sb); err != nil {
		t.Fatalf("patch: %v", err)
	}
	patched, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(patched, &cfg); err != nil {
		t.Fatal(err)
	}
	if got := cfg["disks"].([]any)[0].(map[string]any)["path"]; got != sb.VolumePath {
		t.Errorf("disk path = %v", got)
	}
	if got := cfg["serial"].(map[string]any)["file"]; got != sb.SerialPath {
		t.Errorf("serial path = %v", got)
	}
	vsock := cfg["vsock"].(map[string]any)
	if got := vsock["socket"]; got != sb.VsockUDPath {
		t.Errorf("vsock socket = %v", got)
	}
	netcfg := cfg["net"].([]any)[0].(map[string]any)
	if netcfg["tap"] != sb.TAPName || netcfg["mac"] != sb.MAC {
		t.Errorf("net = %+v", netcfg)
	}
	cmdline := cfg["payload"].(map[string]any)["cmdline"].(string)
	if cmdline == "console=ttyS0 fastvm.hostname=oldsandbox" {
		t.Errorf("hostname was not rewritten: %q", cmdline)
	}
}

func TestPatchSnapshotConfigRemovesNIC(t *testing.T) {
	dir := t.TempDir()
	data := []byte(`{"net":[{"tap":"tap-old"}]}`)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := patchSnapshotConfig(dir, &types.Sandbox{ID: "new"}); err != nil {
		t.Fatal(err)
	}
	out, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(out, &cfg); err != nil {
		t.Fatal(err)
	}
	if _, ok := cfg["net"]; ok {
		t.Errorf("net should be removed for an offline restore")
	}
}
