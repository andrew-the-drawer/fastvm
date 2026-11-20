package image

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/registry"
	"github.com/google/go-containerregistry/pkg/v1/empty"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/tarball"
)

func TestRegistryRootfs(t *testing.T) {
	var layerTar bytes.Buffer
	tw := tar.NewWriter(&layerTar)
	content := []byte("hello from registry\n")
	if err := tw.WriteHeader(&tar.Header{Name: "etc/hello", Mode: 0o644, Size: int64(len(content))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	layer, err := tarball.LayerFromReader(bytes.NewReader(layerTar.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	img, err := mutate.AppendLayers(empty.Image, layer)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(registry.New())
	defer srv.Close()
	ref, err := name.NewTag(srv.Listener.Addr().String()+"/test:latest", name.Insecure)
	if err != nil {
		t.Fatal(err)
	}
	if err := remote.Write(ref, img); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	b, err := NewBuilder(Options{BaseDir: filepath.Join(dir, "images"), InsecureRegistry: true})
	if err != nil {
		t.Fatal(err)
	}
	rootfs, cleanup, err := b.registryRootfs(context.Background(), ref.String())
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	got, err := os.ReadFile(filepath.Join(rootfs, "etc", "hello"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(content) {
		t.Fatalf("rootfs file = %q, want %q", got, content)
	}
}

func TestExtractTarRejectsEscape(t *testing.T) {
	var b bytes.Buffer
	tw := tar.NewWriter(&b)
	_ = tw.WriteHeader(&tar.Header{Name: "../escape", Mode: 0o644, Size: 1})
	_, _ = io.WriteString(tw, "x")
	_ = tw.Close()
	dir := t.TempDir()
	if err := extractTar(dir, &b); err != nil {
		t.Fatalf("extractTar: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "..", "escape")); err == nil {
		t.Fatal("path traversal entry was extracted")
	}
}
