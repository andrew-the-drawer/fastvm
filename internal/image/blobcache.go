package image

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/go-containerregistry/pkg/v1"
	v1types "github.com/google/go-containerregistry/pkg/v1/types"
	"github.com/klauspost/compress/zstd"
)

// ensureLayersCached downloads missing compressed layers into the shared blob
// cache and returns their cache paths. It fetches up to four layers at once.
func (b *FSBuilder) ensureLayersCached(ctx context.Context, layers []v1.Layer) ([]string, error) {
	paths := make([]string, len(layers))
	errs := make([]error, len(layers))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, layer := range layers {
		wg.Add(1)
		go func(i int, layer v1.Layer) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				errs[i] = ctx.Err()
				return
			}
			defer func() { <-sem }()
			paths[i], errs[i] = b.cacheLayer(ctx, layer)
		}(i, layer)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return paths, nil
}

// cacheLayer returns the path of one compressed layer, downloading it if the
// content-addressed cache does not already contain it.
func (b *FSBuilder) cacheLayer(ctx context.Context, layer v1.Layer) (string, error) {
	digest, err := layer.Digest()
	if err != nil {
		return "", fmt.Errorf("image: layer digest: %w", err)
	}
	digestHex, ok := digestHexFromRef(digest.String())
	if !ok {
		return "", fmt.Errorf("image: invalid layer digest %q", digest)
	}
	dir := filepath.Join(b.baseDir, "blobs", "sha256")
	path := filepath.Join(dir, digestHex)
	if st, err := os.Stat(path); err == nil && st.Mode().IsRegular() {
		return path, nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("image: cache layers: %w", err)
	}
	rc, err := layer.Compressed()
	if err != nil {
		return "", fmt.Errorf("image: fetch layer %s: %w", digestHex, err)
	}
	defer rc.Close()
	tmp, err := os.CreateTemp(dir, ".layer-*")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	committed := false
	defer func() {
		if !committed {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
		}
	}()
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, h), rc); err != nil {
		return "", fmt.Errorf("image: cache layer %s: %w", digestHex, err)
	}
	if got := fmt.Sprintf("%x", h.Sum(nil)); got != digestHex {
		return "", fmt.Errorf("image: layer digest mismatch: got %s, want %s", got, digestHex)
	}
	if err := tmp.Sync(); err != nil {
		return "", err
	}
	if err := tmp.Chmod(0o600); err != nil {
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		// A concurrent pull may have completed the same blob first.
		if _, statErr := os.Stat(path); statErr == nil {
			_ = os.Remove(tmpPath)
			committed = true
			return path, nil
		}
		return "", err
	}
	committed = true
	return path, nil
}

// openLayerTar opens a cached compressed layer and returns its uncompressed tar
// stream. The returned closer closes both the decompressor and the file.
func openLayerTar(path string, mt v1types.MediaType) (io.ReadCloser, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	switch mt {
	case v1types.OCIUncompressedLayer, v1types.DockerUncompressedLayer:
		return f, nil
	case v1types.OCILayerZStd:
		zr, err := zstd.NewReader(f)
		if err != nil {
			_ = f.Close()
			return nil, err
		}
		zrc := zr.IOReadCloser()
		return &joinedCloser{Reader: zrc, closers: []io.Closer{zrc, f}}, nil
	default:
		zr, err := gzip.NewReader(f)
		if err != nil {
			_ = f.Close()
			return nil, err
		}
		return &joinedCloser{Reader: zr, closers: []io.Closer{zr, f}}, nil
	}
}

type joinedCloser struct {
	io.Reader
	closers []io.Closer
}

func (j *joinedCloser) Close() error {
	var errs []error
	for _, c := range j.closers {
		if err := c.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
