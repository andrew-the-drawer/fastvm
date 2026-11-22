package cloudhypervisor

// VMM jail (step 1): run each cloud-hypervisor process as an unprivileged,
// per-sandbox UID/GID inside its own cgroup v2, with Cloud Hypervisor's
// Landlock self-sandboxing enabled. See docs/VMM_JAIL.md for the threat model
// and what this does and does not protect.
//
// The daemon stays root and does the privileged setup for the VMM:
//   - chowns the sandbox's own files (disk, sandbox dir) to the jail UID;
//   - opens the TAP device and passes the open FD (fd 3) to the VMM, because
//     Cloud Hypervisor always calls SIOCSIFFLAGS on a TAP it opens by name,
//     which requires CAP_NET_ADMIN;
//   - creates the cgroup and starts the VMM directly inside it (clone3 with
//     CLONE_INTO_CGROUP), so there is no window where it runs unconfined.
// The VMM is started with setuid/setgid to the jail IDs plus the /dev/kvm
// group. Changing from UID 0 to a non-zero UID clears all capabilities.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// tapFD is the file descriptor number of the TAP in the jailed VMM:
// exec.Cmd.ExtraFiles[0] becomes fd 3 in the child.
const tapFD = 3

// JailOptions configures the VMM jail. A nil *JailOptions disables it.
type JailOptions struct {
	// DataDir is the daemon data directory. Directories between it and the
	// files a VMM needs get the "others may traverse" bit (o+x, not o+r) so
	// the jail UID can reach its own files without listing anyone else's.
	DataDir string
	// UIDBase/UIDCount is the UID/GID range for VMM processes.
	UIDBase  uint32
	UIDCount uint32
	// CgroupRoot is the cgroup v2 parent, e.g. /sys/fs/cgroup/fastvm-vmm.
	CgroupRoot string
	// MemoryOverheadMB is added to guest RAM to get memory.max.
	MemoryOverheadMB int
	// PidsMax caps the VMM's threads/processes.
	PidsMax int
}

// jail allocates per-sandbox IDs and prepares jailed launches.
type jail struct {
	opts   JailOptions
	kvmGID uint32
	hasKVM bool

	mu   sync.Mutex
	byID map[string]uint32 // sandbox ID -> UID
	used map[uint32]string // UID -> sandbox ID
	next uint32            // next offset to try; spreads reuse of freed UIDs
}

func newJailState(opts JailOptions) *jail {
	return &jail{opts: opts, byID: make(map[string]uint32), used: make(map[uint32]string)}
}

// acquire returns the UID for sandboxID, allocating one if needed. The same
// sandbox gets the same UID while it holds one.
func (j *jail) acquire(sandboxID string) (uint32, error) {
	if sandboxID == "" {
		return 0, errors.New("cloudhypervisor: jail needs a sandbox ID")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if uid, ok := j.byID[sandboxID]; ok {
		return uid, nil
	}
	for i := uint32(0); i < j.opts.UIDCount; i++ {
		off := (j.next + i) % j.opts.UIDCount
		uid := j.opts.UIDBase + off
		if _, taken := j.used[uid]; taken {
			continue
		}
		j.used[uid] = sandboxID
		j.byID[sandboxID] = uid
		j.next = (off + 1) % j.opts.UIDCount
		return uid, nil
	}
	return 0, fmt.Errorf("cloudhypervisor: jail UID range exhausted (%d in use)", len(j.used))
}

// release frees the UID held by sandboxID.
func (j *jail) release(sandboxID string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if uid, ok := j.byID[sandboxID]; ok {
		delete(j.byID, sandboxID)
		delete(j.used, uid)
	}
}

// memoryMaxBytes is the cgroup memory.max for a guest of memMB.
func (j *jail) memoryMaxBytes(memMB int) int64 {
	return int64(effectiveMemoryMB(memMB)+j.opts.MemoryOverheadMB) << 20
}

// chownTree hands root (a file or directory tree) to uid:gid. Symlinks are
// changed themselves (Lchown) and never followed, so a link planted inside the
// sandbox directory cannot redirect a chown to a host file.
func chownTree(root string, uid, gid int) error {
	return filepath.WalkDir(root, func(path string, _ fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		return os.Lchown(path, uid, gid)
	})
}

// ensureTraversable adds o+x to every directory from base down to (and
// including) dir, so a non-owner can path-walk through them. It never touches
// directories above base and refuses dirs outside it.
func ensureTraversable(base, dir string) error {
	base, dir = filepath.Clean(base), filepath.Clean(dir)
	rel, err := filepath.Rel(base, dir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, "../") {
		return fmt.Errorf("cloudhypervisor: jail path %s is outside the data dir %s", dir, base)
	}
	cur := base
	parts := []string{}
	if rel != "." {
		parts = strings.Split(rel, string(filepath.Separator))
	}
	for i := 0; ; i++ {
		st, err := os.Lstat(cur)
		if err != nil {
			return fmt.Errorf("cloudhypervisor: jail: %w", err)
		}
		if !st.IsDir() {
			return fmt.Errorf("cloudhypervisor: jail: %s is not a directory", cur)
		}
		if st.Mode().Perm()&0o001 == 0 {
			if err := os.Chmod(cur, st.Mode().Perm()|0o001); err != nil {
				return fmt.Errorf("cloudhypervisor: jail: make %s traversable: %w", cur, err)
			}
		}
		if i == len(parts) {
			return nil
		}
		cur = filepath.Join(cur, parts[i])
	}
}

// checkReachable verifies that every ancestor directory of path lets others
// traverse it. The jail only ever chmods directories inside the data dir, so
// anything above it must already be traversable.
func checkReachable(path string) error {
	for dir := filepath.Dir(filepath.Clean(path)); ; dir = filepath.Dir(dir) {
		st, err := os.Stat(dir)
		if err != nil {
			return err
		}
		if st.Mode().Perm()&0o001 == 0 {
			return fmt.Errorf("cloudhypervisor: jail: %s is not traversable by the VMM user (needs o+x)", dir)
		}
		if dir == "/" {
			return nil
		}
	}
}

// checkWorldReadable is used for shared inputs (the kernel) that the jail
// must not chown: the VMM user needs read access through "other" bits.
func checkWorldReadable(path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("cloudhypervisor: jail: %w", err)
	}
	if st.Mode().Perm()&0o004 == 0 {
		return fmt.Errorf("cloudhypervisor: jail: %s must be world-readable (o+r) for the unprivileged VMM", path)
	}
	return checkReachable(path)
}

// jailBootArgs rewrites a cold-boot command line for a jailed VMM: the TAP is
// passed as an inherited FD instead of by name, and Landlock is enabled with
// read-write access to the sandbox directory (where snapshots are written).
// Cloud Hypervisor adds Landlock rules for its own disk, kernel, serial, vsock
// and virtio-fs paths.
func jailBootArgs(args []string, home string) []string {
	out := make([]string, 0, len(args)+4)
	for i := 0; i < len(args); i++ {
		if args[i] == "--net" && i+1 < len(args) {
			out = append(out, "--net", replaceTapWithFD(args[i+1]))
			i++
			continue
		}
		out = append(out, args[i])
	}
	return append(out, "--landlock", "--landlock-rules", landlockRule(home))
}

func replaceTapWithFD(netArg string) string {
	fields := strings.Split(netArg, ",")
	out := []string{fmt.Sprintf("fd=[%d]", tapFD)}
	for _, f := range fields {
		if !strings.HasPrefix(f, "tap=") {
			out = append(out, f)
		}
	}
	return strings.Join(out, ",")
}

func landlockRule(path string) string {
	return fmt.Sprintf("path=%s,access=rw", path)
}

// snapshotInfo is what the jail needs from a Cloud Hypervisor snapshot's
// config.json before restoring it.
type snapshotInfo struct {
	DiskPaths   []string
	NetIDs      []string
	MemoryBytes int64
}

// patchSnapshotForJail rewrites a snapshot's config.json for a jailed restore:
//   - drops net[].tap: CH prefers a TAP name over FDs, and opening by name
//     needs CAP_NET_ADMIN; the restore passes the TAP as external_fds instead;
//   - enables Landlock and points its extra rule at this sandbox's directory.
//     The rule is saved in the snapshot and re-applied by CH on restore, so a
//     clone restored into a new sandbox directory must not keep the old path.
func patchSnapshotForJail(snapshotDir, home string) (snapshotInfo, error) {
	path := filepath.Join(snapshotDir, "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return snapshotInfo{}, fmt.Errorf("cloudhypervisor: jail: read snapshot config: %w", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		return snapshotInfo{}, fmt.Errorf("cloudhypervisor: jail: parse snapshot config: %w", err)
	}
	var info snapshotInfo
	if disks, ok := cfg["disks"].([]any); ok {
		for _, d := range disks {
			if m, ok := d.(map[string]any); ok {
				if p, ok := m["path"].(string); ok && p != "" {
					info.DiskPaths = append(info.DiskPaths, p)
				}
			}
		}
	}
	if nets, ok := cfg["net"].([]any); ok {
		for i, n := range nets {
			m, ok := n.(map[string]any)
			if !ok {
				continue
			}
			id, _ := m["id"].(string)
			if id == "" {
				return snapshotInfo{}, fmt.Errorf("cloudhypervisor: jail: snapshot net[%d] has no id", i)
			}
			info.NetIDs = append(info.NetIDs, id)
			delete(m, "tap")
			delete(m, "fds")
		}
	}
	if mem, ok := cfg["memory"].(map[string]any); ok {
		if size, ok := mem["size"].(float64); ok {
			info.MemoryBytes = int64(size)
		}
	}
	cfg["landlock_enable"] = true
	cfg["landlock_rules"] = []any{map[string]any{"path": home, "access": "rw"}}
	out, err := json.Marshal(cfg)
	if err != nil {
		return snapshotInfo{}, err
	}
	if err := os.WriteFile(path, out, 0o600); err != nil {
		return snapshotInfo{}, fmt.Errorf("cloudhypervisor: jail: write snapshot config: %w", err)
	}
	return info, nil
}

// jailRestoreSource builds the --restore value, handing the TAP FD to the
// snapshot's (single) network device.
func jailRestoreSource(snapshotDir string, netIDs []string) (string, error) {
	src := "source_url=file://" + snapshotDir
	switch len(netIDs) {
	case 0:
		return src, nil
	case 1:
		return fmt.Sprintf("%s,external_fds=[net(%s)@[%d]]", src, netIDs[0], tapFD), nil
	default:
		return "", fmt.Errorf("cloudhypervisor: jail supports one network device, snapshot has %d", len(netIDs))
	}
}

// within reports whether path is dir or below it.
func within(dir, path string) bool {
	rel, err := filepath.Rel(filepath.Clean(dir), filepath.Clean(path))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, "../")
}

// jailHome is the directory a jailed VMM owns: the one holding its API socket
// (the sandbox directory in fastvmd).
func jailHome(p vmPaths) string { return filepath.Dir(p.apiSock) }

// checkJailPaths makes sure every file the VMM creates itself (serial log,
// vsock socket) lives in its home, which is the only directory it can write.
func (d *Driver) checkJailPaths(p vmPaths, vsock string) error {
	home := jailHome(p)
	for _, path := range []string{p.serial, vsock} {
		if path != "" && !within(home, path) {
			return fmt.Errorf("cloudhypervisor: jail: %s must be inside the sandbox directory %s", path, home)
		}
	}
	return nil
}

// abortJail releases a jail identity and cgroup; nil is a no-op.
func (d *Driver) abortJail(jl *jailLaunch) {
	if jl != nil && d.jail != nil {
		jl.closeParentFDs()
		d.jail.cleanup(jl.sandboxID)
	}
}

// jailedSnapshot writes a snapshot from a jailed VMM. The VMM may only write
// in its home, so a snapshot destined elsewhere (fastvmctl snapshot exports
// to <data_dir>/snapshots/<name>) is staged in the home and moved by the
// daemon, then handed back to the daemon's user.
func (v *vm) jailedSnapshot(ctx context.Context, dir string) error {
	home := jailHome(v.paths)
	uid, gid := int(v.jailed.uid), int(v.jailed.gid)
	if within(home, dir) {
		if err := os.Lchown(dir, uid, gid); err != nil {
			return fmt.Errorf("cloudhypervisor: jail: chown snapshot dir: %w", err)
		}
		if err := v.api.snapshot(ctx, dir); err != nil {
			return fmt.Errorf("cloudhypervisor: snapshot: %w", err)
		}
		return nil
	}
	staging, err := os.MkdirTemp(home, ".snapshot-")
	if err != nil {
		return fmt.Errorf("cloudhypervisor: jail: snapshot staging: %w", err)
	}
	defer os.RemoveAll(staging)
	if err := os.Lchown(staging, uid, gid); err != nil {
		return fmt.Errorf("cloudhypervisor: jail: chown snapshot staging: %w", err)
	}
	if err := v.api.snapshot(ctx, staging); err != nil {
		return fmt.Errorf("cloudhypervisor: snapshot: %w", err)
	}
	entries, err := os.ReadDir(staging)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := os.Rename(filepath.Join(staging, e.Name()), filepath.Join(dir, e.Name())); err != nil {
			return fmt.Errorf("cloudhypervisor: jail: move snapshot file (staging and destination must share a filesystem): %w", err)
		}
	}
	return chownTree(dir, os.Geteuid(), os.Getegid())
}
