package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"fastvm/internal/types"
)

func TestRunEntrypointOverride(t *testing.T) {
	dir := t.TempDir()
	sock := filepath.Join(dir, "fastvm.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	create := make(chan map[string]any, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/images":
			_ = json.NewEncoder(w).Encode([]types.BaseDisk{{Tag: "busybox"}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sandboxes":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			create <- body
			_ = json.NewEncoder(w).Encode(types.Sandbox{ID: "sb1", Name: "ep", State: types.StateRunning})
		case r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	file := filepath.Join(dir, "ep.fvmfile")
	if err := os.WriteFile(file, []byte(`
version: 1
name: ep
image: busybox
entrypoint: ["copilot"]
`), 0o600); err != nil {
		t.Fatal(err)
	}

	root := newRootCmd()
	root.SetOut(io.Discard)
	root.SetErr(io.Discard)
	root.SetArgs([]string{"--socket", sock, "run", "-d", "-f", file, "--entrypoint", "bash", "--workdir", "/workspace", "--auto-publish"})
	_ = root.ExecuteContext(context.Background())

	select {
	case body := <-create:
		cmd, _ := body["cmd"].([]any)
		if len(cmd) != 1 || cmd[0] != "bash" {
			t.Fatalf("workload argv = %v, want [bash]", body["cmd"])
		}
		if body["workdir"] != "/workspace" {
			t.Fatalf("workdir = %v", body["workdir"])
		}
		if body["auto_publish"] != true || body["network_enabled"] != true {
			t.Fatalf("auto_publish/network = %v/%v", body["auto_publish"], body["network_enabled"])
		}
	case <-time.After(5 * time.Second):
		t.Fatal("create request was not sent")
	}
}
