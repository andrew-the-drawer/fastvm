package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSplitCopyArg(t *testing.T) {
	dir := t.TempDir()
	local := filepath.Join(dir, "with:colon")
	if err := os.WriteFile(local, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, p, remote := splitCopyArg("my-vm:remote.txt"); !remote || p != "remote.txt" {
		t.Fatalf("remote parse: remote=%v path=%q", remote, p)
	}
	if _, p, remote := splitCopyArg(local); remote || p != local {
		t.Fatalf("local parse: remote=%v path=%q", remote, p)
	}
}
