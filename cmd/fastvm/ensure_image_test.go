package main

import (
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"fastvm/internal/types"
)

func TestEnsureImagePullsViaAPI(t *testing.T) {
	dir := t.TempDir()
	sock := filepath.Join(dir, "fastvm.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	pulled := make(chan string, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/images":
			_ = json.NewEncoder(w).Encode([]types.BaseDisk{})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/pull":
			var body struct {
				Ref string `json:"ref"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			pulled <- body.Ref
			_ = json.NewEncoder(w).Encode(types.BaseDisk{Name: body.Ref, Digest: "sha256:abc", SizeBytes: 1})
		default:
			http.NotFound(w, r)
		}
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	socketFlag = sock
	t.Cleanup(func() { socketFlag = "" })
	if err := ensureImage("alpine:3.20"); err != nil {
		t.Fatalf("ensureImage: %v", err)
	}
	select {
	case ref := <-pulled:
		if ref != "alpine:3.20" {
			t.Fatalf("pulled ref = %q", ref)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("pull request was not sent")
	}
}
