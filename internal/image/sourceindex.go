package image

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/go-containerregistry/pkg/v1"
)

// Source-index entries map (image manifest, agent, init, format, size) to a
// base-disk digest. They let Pull reuse a disk without extracting the image
// layers again.
func (b *FSBuilder) sourceDir() string { return filepath.Join(b.baseDir, "sources") }

func (b *FSBuilder) sourcePath(key string) string {
	return filepath.Join(b.sourceDir(), key)
}

// sourceKey identifies the inputs that determine the resulting base disk.
func (b *FSBuilder) sourceKey(img v1.Image, spec PullSpec) (string, error) {
	manifest, err := img.Digest()
	if err != nil {
		return "", fmt.Errorf("image: manifest digest: %w", err)
	}
	agentPath := firstNonEmpty(spec.AgentPath, b.agentPath)
	initPath := firstNonEmpty(spec.InitPath, b.initPath)
	agentHash := "none"
	if agentPath != "" {
		agentHash, err = hashFile(agentPath)
		if err != nil {
			return "", fmt.Errorf("image: hash agent: %w", err)
		}
	}
	initHash, err := hashString(builtinInit)
	if err != nil {
		return "", err
	}
	switch {
	case initPath != "":
		initHash, err = hashFile(initPath)
		if err != nil {
			return "", fmt.Errorf("image: hash init: %w", err)
		}
	case agentPath != "":
		initHash = agentHash
	}
	sizeGB := spec.SizeGB
	if sizeGB == 0 {
		sizeGB = DefaultSizeGB
	}
	h := sha256.New()
	fmt.Fprintf(h, "fastvm-source-v1\x00%s\x00%s\x00%s\x00%d\x00%d",
		manifest.String(), agentHash, initHash, formatVersion, sizeGB)
	return hex.EncodeToString(h.Sum(nil)), nil
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func hashString(s string) (string, error) {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:]), nil
}

func (b *FSBuilder) lookupSource(key string) (string, bool) {
	data, err := os.ReadFile(b.sourcePath(key))
	if err != nil {
		return "", false
	}
	digestHex, ok := digestHexFromRef(strings.TrimSpace(string(data)))
	if !ok {
		_ = os.Remove(b.sourcePath(key))
		return "", false
	}
	return digestHex, true
}

func (b *FSBuilder) recordSource(key, digestHex string) error {
	if err := os.MkdirAll(b.sourceDir(), 0o700); err != nil {
		return fmt.Errorf("image: create source index: %w", err)
	}
	if err := writeFileAtomic(b.sourcePath(key), []byte(digestHex+"\n"), 0o600); err != nil {
		return fmt.Errorf("image: record source index: %w", err)
	}
	return nil
}

// removeSourcesFor deletes source-index entries pointing at digestHex.
func (b *FSBuilder) removeSourcesFor(digestHex string) {
	entries, err := os.ReadDir(b.sourceDir())
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(b.sourceDir(), entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if strings.TrimSpace(string(data)) == digestHex {
			_ = os.Remove(path)
		}
	}
}
