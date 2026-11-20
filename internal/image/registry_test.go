package image

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/registry"
	"github.com/google/go-containerregistry/pkg/v1"
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
	entries, err := os.ReadDir(filepath.Join(b.baseDir, "blobs", "sha256"))
	if err != nil || len(entries) == 0 {
		t.Fatalf("layer cache is empty: %v", err)
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

func TestExtractTarWhiteouts(t *testing.T) {
	dir := t.TempDir()
	base := tarballLayer(t, map[string]string{"etc/old": "old\n", "etc/keep": "keep\n"})
	rc, err := base.Uncompressed()
	if err != nil {
		t.Fatal(err)
	}
	if err := extractTar(dir, rc); err != nil {
		t.Fatal(err)
	}
	_ = rc.Close()
	whiteout := tarballLayer(t, map[string]string{"etc/.wh.old": ""})
	rc, err = whiteout.Uncompressed()
	if err != nil {
		t.Fatal(err)
	}
	if err := extractTar(dir, rc); err != nil {
		t.Fatal(err)
	}
	_ = rc.Close()
	if _, err := os.Stat(filepath.Join(dir, "etc", "old")); !os.IsNotExist(err) {
		t.Fatalf("whiteouted file still exists: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "etc", "keep")); err != nil || string(data) != "keep\n" {
		t.Fatalf("kept file = %q, %v", data, err)
	}
}

func tarballLayer(t *testing.T, files map[string]string) v1.Layer {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for name, content := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(content))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	layer, err := tarball.LayerFromReader(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	return layer
}

func TestLayerCacheReusedAcrossPulls(t *testing.T) {
	requireMke2fs(t)
	reg := registry.New()
	var blobRequests atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/blobs/") {
			blobRequests.Add(1)
		}
		reg.ServeHTTP(w, r)
	}))
	defer srv.Close()

	layer := tarballLayer(t, map[string]string{"etc/hello": "hello\n"})
	img, err := mutate.AppendLayers(empty.Image, layer)
	if err != nil {
		t.Fatal(err)
	}
	ref, err := name.NewTag(srv.Listener.Addr().String()+"/cache:latest", name.Insecure)
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
	if _, err := b.Pull(context.Background(), PullSpec{Ref: ref.String(), SizeGB: 1}); err != nil {
		t.Fatalf("first pull: %v", err)
	}
	first := blobRequests.Load()
	if first == 0 {
		t.Fatal("first pull did not fetch any blobs")
	}
	if _, err := b.Pull(context.Background(), PullSpec{Ref: ref.String(), SizeGB: 1}); err != nil {
		t.Fatalf("second pull: %v", err)
	}
	if got := blobRequests.Load(); got != first {
		t.Fatalf("second pull fetched %d blob requests, want %d (cache miss)", got-first, first)
	}
}

func TestLayerCacheRedownloadsOnlyDeletedBlob(t *testing.T) {
	requireMke2fs(t)
	reg := registry.New()
	var mu sync.Mutex
	layerDigests := []string{}
	requests := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		for _, d := range layerDigests {
			if strings.Contains(r.URL.Path, d) {
				requests[d]++
			}
		}
		mu.Unlock()
		reg.ServeHTTP(w, r)
	}))
	defer srv.Close()

	images := make([]v1.Layer, 0, 3)
	for _, name := range []string{"etc/a", "etc/b", "etc/c"} {
		layer := tarballLayer(t, map[string]string{name: name + "\n"})
		digest, err := layer.Digest()
		if err != nil {
			t.Fatal(err)
		}
		layerDigests = append(layerDigests, digest.String())
		images = append(images, layer)
	}
	img, err := mutate.AppendLayers(empty.Image, images...)
	if err != nil {
		t.Fatal(err)
	}
	ref, err := name.NewTag(srv.Listener.Addr().String()+"/multi:latest", name.Insecure)
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
	if _, err := b.Pull(context.Background(), PullSpec{Ref: ref.String(), SizeGB: 1}); err != nil {
		t.Fatalf("first pull: %v", err)
	}
	mu.Lock()
	firstCounts := make(map[string]int, len(requests))
	for k, v := range requests {
		firstCounts[k] = v
	}
	for k := range requests {
		delete(requests, k)
	}
	mu.Unlock()
	if len(firstCounts) != len(layerDigests) {
		t.Fatalf("first pull requested %d layers, want %d", len(firstCounts), len(layerDigests))
	}

	hex, _ := digestHexFromRef(layerDigests[1])
	missingPath := filepath.Join(dir, "images", "blobs", "sha256", hex)
	if err := os.Remove(missingPath); err != nil {
		t.Fatalf("remove cached blob: %v", err)
	}
	// Exercise the layer cache directly; the source index would otherwise
	// bypass extraction entirely.
	if err := os.RemoveAll(filepath.Join(dir, "images", "sources")); err != nil {
		t.Fatal(err)
	}

	if _, err := b.Pull(context.Background(), PullSpec{Ref: ref.String(), SizeGB: 1}); err != nil {
		t.Fatalf("second pull: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if requests[layerDigests[1]] == 0 {
		t.Fatal("missing layer was not re-downloaded")
	}
	for _, digest := range layerDigests {
		if digest == layerDigests[1] {
			continue
		}
		if requests[digest] != 0 {
			t.Fatalf("cached layer %s was re-downloaded %d times", digest, requests[digest])
		}
	}
}

func TestSourceIndexSkipsExtractionAndBlobs(t *testing.T) {
	requireMke2fs(t)
	reg := registry.New()
	var blobRequests atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/blobs/") {
			blobRequests.Add(1)
		}
		reg.ServeHTTP(w, r)
	}))
	defer srv.Close()

	layer := tarballLayer(t, map[string]string{"etc/hello": "hello\n"})
	img, err := mutate.AppendLayers(empty.Image, layer)
	if err != nil {
		t.Fatal(err)
	}
	ref, err := name.NewTag(srv.Listener.Addr().String()+"/source:latest", name.Insecure)
	if err != nil {
		t.Fatal(err)
	}
	if err := remote.Write(ref, img); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	imagesDir := filepath.Join(dir, "images")
	b, err := NewBuilder(Options{BaseDir: imagesDir, InsecureRegistry: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.Pull(context.Background(), PullSpec{Ref: ref.String(), SizeGB: 1}); err != nil {
		t.Fatalf("first pull: %v", err)
	}
	sources, err := os.ReadDir(filepath.Join(imagesDir, "sources"))
	if err != nil || len(sources) == 0 {
		t.Fatalf("source index is empty: %v", err)
	}
	if err := os.RemoveAll(filepath.Join(imagesDir, "blobs")); err != nil {
		t.Fatal(err)
	}
	blobRequests.Store(0)

	if _, err := b.Pull(context.Background(), PullSpec{Ref: ref.String(), SizeGB: 1}); err != nil {
		t.Fatalf("second pull via source index: %v", err)
	}
	if got := blobRequests.Load(); got != 0 {
		t.Fatalf("source-index pull requested %d layer blobs, want 0", got)
	}
}
