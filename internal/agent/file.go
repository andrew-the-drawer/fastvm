package agent

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func fileStat(path string) (int64, uint32, error) {
	if path == "" {
		return 0, 0, fmt.Errorf("path is required")
	}
	st, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	if !st.Mode().IsRegular() {
		return 0, 0, fmt.Errorf("%s is not a regular file", path)
	}
	return st.Size(), uint32(st.Mode().Perm()), nil
}

func fileRead(path string, offset int64, maxBytes int) ([]byte, int64, uint32, error) {
	if offset < 0 {
		return nil, 0, 0, fmt.Errorf("offset must not be negative")
	}
	if maxBytes <= 0 || maxBytes > 1<<20 {
		maxBytes = 1 << 20
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, 0, 0, err
	}
	if !st.Mode().IsRegular() {
		return nil, 0, 0, fmt.Errorf("%s is not a regular file", path)
	}
	if offset > st.Size() {
		return nil, st.Size(), uint32(st.Mode().Perm()), nil
	}
	buf := make([]byte, maxBytes)
	n, err := f.ReadAt(buf, offset)
	if err != nil && err != io.EOF {
		return nil, 0, 0, err
	}
	return buf[:n], st.Size(), uint32(st.Mode().Perm()), nil
}

func fileWrite(path string, offset int64, mode uint32, data []byte) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}
	if offset < 0 {
		return fmt.Errorf("offset must not be negative")
	}
	if mode == 0 {
		mode = 0o644
	}
	flags := os.O_WRONLY
	if offset == 0 {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		flags |= os.O_CREATE | os.O_TRUNC
	}
	f, err := os.OpenFile(path, flags, os.FileMode(mode))
	if err != nil {
		return err
	}
	if err := f.Chmod(os.FileMode(mode)); err != nil {
		f.Close()
		return err
	}
	if _, err := f.WriteAt(data, offset); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
