package agent

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestFileWriteReadStat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "file.bin")
	data := bytes.Repeat([]byte("abc"), 400000)
	first := data[:1<<20]
	second := data[1<<20:]
	if err := fileWrite(path, 0, 0o640, first); err != nil {
		t.Fatal(err)
	}
	if err := fileWrite(path, int64(len(first)), 0o640, second); err != nil {
		t.Fatal(err)
	}
	size, mode, err := fileStat(path)
	if err != nil {
		t.Fatal(err)
	}
	if size != int64(len(data)) || mode != 0o640 {
		t.Fatalf("stat = %d %o", size, mode)
	}
	got, _, _, err := fileRead(path, int64(len(first)), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, second) {
		t.Fatalf("read mismatch: %d bytes", len(got))
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}
