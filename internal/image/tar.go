package image

import (
	"archive/tar"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"sort"
	"strings"
)

// pendingHardlink is a tar hard link whose target had not been extracted yet.
type pendingHardlink struct {
	target string
	name   string
}

// extractTar unpacks a rootfs tar stream into dest using os.Root, which makes
// path traversal and symlink-escape attacks impossible by construction.
func extractTar(dest string, r io.Reader) error {
	root, err := os.OpenRoot(dest)
	if err != nil {
		return fmt.Errorf("open rootfs root: %w", err)
	}
	defer root.Close()

	var (
		dirs    []dirMode
		pending []pendingHardlink
		buf     = make([]byte, 1<<20)
	)

	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar: %w", err)
		}
		name := cleanTarPath(hdr.Name)
		if name == "" {
			continue
		}
		base := path.Base(name)
		dir := path.Dir(name)
		if base == ".wh..wh..opq" {
			if err := removeChildren(root, dir); err != nil {
				return fmt.Errorf("opaque whiteout %q: %w", name, err)
			}
			continue
		}
		if strings.HasPrefix(base, ".wh.") {
			target := path.Join(dir, strings.TrimPrefix(base, ".wh."))
			if target != "." && target != "" {
				if err := root.RemoveAll(target); err != nil && !errors.Is(err, fs.ErrNotExist) {
					return fmt.Errorf("whiteout %q: %w", target, err)
				}
			}
			continue
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			mode := tarDirMode(hdr.Mode)
			// os.Root.MkdirAll only accepts permission bits; special bits are
			// applied with Chmod once the tree is populated.
			if err := root.MkdirAll(name, permOnly(mode)); err != nil {
				return fmt.Errorf("mkdir %q: %w", name, err)
			}
			dirs = append(dirs, dirMode{path: name, mode: tarFinalDirMode(hdr.Mode)})
		case tar.TypeReg:
			mode := tarFileMode(hdr.Mode)
			dir := path.Dir(name)
			if dir != "." {
				if err := root.MkdirAll(dir, 0o755); err != nil {
					return fmt.Errorf("mkdir %q: %w", dir, err)
				}
			}
			f, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, permOnly(mode))
			if err != nil {
				return fmt.Errorf("create %q: %w", name, err)
			}
			if _, err := io.CopyBuffer(f, tr, buf); err != nil {
				_ = f.Close()
				return fmt.Errorf("write %q: %w", name, err)
			}
			if err := f.Close(); err != nil {
				return fmt.Errorf("close %q: %w", name, err)
			}
			if err := root.Chmod(name, mode); err != nil {
				return fmt.Errorf("chmod %q: %w", name, err)
			}
		case tar.TypeSymlink:
			dir := path.Dir(name)
			if dir != "." {
				if err := root.MkdirAll(dir, 0o755); err != nil {
					return fmt.Errorf("mkdir %q: %w", dir, err)
				}
			}
			// A later entry wins; drop whatever is already there.
			_ = root.Remove(name)
			if err := root.Symlink(hdr.Linkname, name); err != nil {
				return fmt.Errorf("symlink %q -> %q: %w", name, hdr.Linkname, err)
			}
		case tar.TypeLink:
			target := cleanTarPath(hdr.Linkname)
			if target == "" {
				continue
			}
			dir := path.Dir(name)
			if dir != "." {
				if err := root.MkdirAll(dir, 0o755); err != nil {
					return fmt.Errorf("mkdir %q: %w", dir, err)
				}
			}
			if err := root.Link(target, name); err != nil {
				if errors.Is(err, fs.ErrNotExist) {
					pending = append(pending, pendingHardlink{target: target, name: name})
					continue
				}
				return fmt.Errorf("hardlink %q -> %q: %w", name, target, err)
			}
		default:
			// Device nodes, FIFOs, sockets and tar metadata are recreated by
			// the guest at boot (or are irrelevant), so skip them.
		}
	}
	for _, link := range pending {
		if err := root.Link(link.target, link.name); err != nil {
			return fmt.Errorf("hardlink %q -> %q: %w", link.name, link.target, err)
		}
	}
	// Apply directory modes deepest-first once the tree is populated.
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i].path) > len(dirs[j].path) })
	for _, d := range dirs {
		if err := root.Chmod(d.path, d.mode); err != nil {
			return fmt.Errorf("chmod %q: %w", d.path, err)
		}
	}
	return nil
}

// removeChildren removes all entries below dir for OCI opaque whiteouts.
func removeChildren(root *os.Root, dir string) error {
	if dir == "." {
		dir = ""
	}
	openDir := dir
	if openDir == "" {
		openDir = "."
	}
	f, err := root.Open(openDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	entries, err := f.ReadDir(-1)
	_ = f.Close()
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if dir != "" {
			name = path.Join(dir, name)
		}
		if err := root.RemoveAll(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	return nil
}

// cleanTarPath normalizes a tar entry name to a fs.ValidPath-relative path,
// returning "" for entries that try to escape the rootfs.
func cleanTarPath(name string) string {
	name = strings.TrimPrefix(name, "./")
	cleaned := path.Clean("/" + name)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "" || cleaned == "." || !fs.ValidPath(cleaned) {
		return ""
	}
	return cleaned
}

// unixModeToFileMode converts raw tar/unix mode bits to a Go fs.FileMode with
// the setuid/setgid/sticky flags represented correctly.
func unixModeToFileMode(mode int64) fs.FileMode {
	perm := fs.FileMode(mode) & fs.ModePerm
	if mode&0o4000 != 0 {
		perm |= fs.ModeSetuid
	}
	if mode&0o2000 != 0 {
		perm |= fs.ModeSetgid
	}
	if mode&0o1000 != 0 {
		perm |= fs.ModeSticky
	}
	return perm
}

// permOnly strips everything except the permission bits, which is all that
// os.Root.Mkdir/MkdirAll/OpenFile accept.
func permOnly(mode fs.FileMode) fs.FileMode { return mode & fs.ModePerm }

func tarFileMode(mode int64) fs.FileMode {
	perm := unixModeToFileMode(mode)
	if perm&0o400 == 0 {
		perm |= 0o400 // stays readable even if the archive is odd
	}
	if perm == 0 {
		perm = 0o644
	}
	return perm
}

// tarDirMode is used while extracting: the directory must remain writable for
// its children to be created.
func tarDirMode(mode int64) fs.FileMode {
	return unixModeToFileMode(mode) | 0o700
}

func tarFinalDirMode(mode int64) fs.FileMode {
	perm := unixModeToFileMode(mode)
	if perm == 0 {
		perm = 0o755
	}
	return perm
}
