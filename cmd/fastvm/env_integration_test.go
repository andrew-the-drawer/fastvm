package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"fastvm/internal/agent"
	"fastvm/internal/types"
)

// TestRunFVMFileInteractivePassesEnv is a regression test for fvmfile env
// being dropped by the interactive -it path. It runs the real run command
// against a fake daemon and inspects the shell request.
func TestRunFVMFileInteractivePassesEnv(t *testing.T) {
	t.Setenv("TERM", "xterm-256color") // forwarded to the guest; unset in CI/non-TTY shells
	// Short dir: macOS caps unix socket paths at 104 bytes and $TMPDIR is long.
	dir, err := os.MkdirTemp("", "fvm")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	sock := filepath.Join(dir, "fastvm.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	shellReq := make(chan agent.ShellRequest, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/images":
			_ = json.NewEncoder(w).Encode([]types.BaseDisk{{Tag: "busybox"}})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sandboxes":
			_, _ = io.Copy(io.Discard, r.Body)
			_ = json.NewEncoder(w).Encode(types.Sandbox{ID: "sb1", Name: "envtest", State: types.StateRunning})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sandboxes/sb1/shell":
			var req agent.ShellRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			shellReq <- req
			hj, ok := w.(http.Hijacker)
			if !ok {
				t.Error("fake daemon cannot hijack")
				return
			}
			conn, _, err := hj.Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			fmt.Fprint(conn, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fastvm-shell\r\n\r\n")
			_ = conn.Close()
		case r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	file := filepath.Join(dir, "env.fvmfile")
	if err := os.WriteFile(file, []byte(`
version: 1
name: envtest
image: busybox
command: ["sh", "-c", "exit 0"]
env:
  TOKEN: from-file
`), 0o600); err != nil {
		t.Fatal(err)
	}

	root := newRootCmd()
	root.SetArgs([]string{"--socket", sock, "run", "-f", file, "-it"})
	root.SetOut(io.Discard)
	root.SetErr(io.Discard)
	_ = root.ExecuteContext(context.Background())

	select {
	case req := <-shellReq:
		if req.Env["TOKEN"] != "from-file" {
			t.Fatalf("shell env = %v, want TOKEN=from-file", req.Env)
		}
		if req.Env["TERM"] == "" {
			t.Fatalf("shell env lacks TERM: %v", req.Env)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shell request was not sent")
	}
}
