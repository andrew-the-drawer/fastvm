//go:build linux

package cloudhypervisor

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

var cgroupNameRE = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// newJail validates the host for jailed VMMs: cgroup v2 with the memory and
// pids controllers, a reachable data dir, and the /dev/kvm group.
func newJail(opts JailOptions) (*jail, error) {
	if opts.DataDir == "" || !filepath.IsAbs(opts.DataDir) {
		return nil, errors.New("cloudhypervisor: jail needs an absolute DataDir")
	}
	if opts.UIDBase == 0 || opts.UIDCount == 0 {
		return nil, errors.New("cloudhypervisor: jail needs a non-root UID range")
	}
	if opts.PidsMax <= 0 {
		opts.PidsMax = 512
	}
	if err := checkReachable(filepath.Join(opts.DataDir, ".")); err != nil {
		return nil, err
	}
	j := newJailState(opts)

	// /dev/kvm is usually root:kvm 0660; the VMM joins that group.
	var st unix.Stat_t
	if err := unix.Stat("/dev/kvm", &st); err == nil {
		j.kvmGID, j.hasKVM = st.Gid, true
	}

	// cgroup v2: a child only gets a controller if its parent lists it in
	// cgroup.subtree_control, so delegate memory+pids down two levels:
	// parent -> CgroupRoot -> per-sandbox cgroup.
	parent := filepath.Dir(opts.CgroupRoot)
	if _, err := os.Stat(filepath.Join(parent, "cgroup.controllers")); err != nil {
		return nil, fmt.Errorf("cloudhypervisor: jail needs cgroup v2 at %s: %w", parent, err)
	}
	if err := enableControllers(parent); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(opts.CgroupRoot, 0o755); err != nil {
		return nil, fmt.Errorf("cloudhypervisor: jail: create cgroup %s: %w", opts.CgroupRoot, err)
	}
	if err := enableControllers(opts.CgroupRoot); err != nil {
		return nil, err
	}
	return j, nil
}

// enableControllers makes sure dir delegates memory and pids to its children.
func enableControllers(dir string) error {
	data, err := os.ReadFile(filepath.Join(dir, "cgroup.subtree_control"))
	if err != nil {
		return fmt.Errorf("cloudhypervisor: jail: read %s/cgroup.subtree_control: %w", dir, err)
	}
	have := map[string]bool{}
	for _, c := range strings.Fields(string(data)) {
		have[c] = true
	}
	if have["memory"] && have["pids"] {
		return nil
	}
	if err := os.WriteFile(filepath.Join(dir, "cgroup.subtree_control"), []byte("+memory +pids"), 0); err != nil {
		// EBUSY: dir has processes of its own ("no internal processes" rule).
		return fmt.Errorf("cloudhypervisor: jail: enable memory/pids in %s/cgroup.subtree_control: %w", dir, err)
	}
	return nil
}

// jailSpec is what one jailed VMM launch needs.
type jailSpec struct {
	SandboxID   string
	Home        string   // sandbox directory: API/vsock sockets, serial log, snapshots
	OwnPaths    []string // other files that belong to this sandbox only (its disk)
	KernelPath  string   // shared, must already be world-readable
	MemoryBytes int64    // cgroup memory.max
	TAPName     string   // opened here and passed as fd 3
}

// jailLaunch is a prepared jailed launch. Its FDs are owned by the parent
// until the child has started.
type jailLaunch struct {
	sandboxID string
	uid, gid  uint32
	groups    []uint32
	cgroupDir string
	cgroup    *os.File
	tap       *os.File
}

// prepare allocates the jail identity for one VMM and does the privileged
// setup. On error everything it did is undone except file ownership.
func (j *jail) prepare(spec jailSpec) (_ *jailLaunch, err error) {
	if !cgroupNameRE.MatchString(spec.SandboxID) {
		return nil, fmt.Errorf("cloudhypervisor: jail: invalid sandbox ID %q", spec.SandboxID)
	}
	uid, err := j.acquire(spec.SandboxID)
	if err != nil {
		return nil, err
	}
	l := &jailLaunch{sandboxID: spec.SandboxID, uid: uid, gid: uid}
	if j.hasKVM {
		l.groups = []uint32{j.kvmGID}
	}
	defer func() {
		if err != nil {
			l.closeParentFDs()
			j.cleanup(spec.SandboxID)
		}
	}()

	// Files: the sandbox's own directory and disk become the jail user's.
	if err := ensureTraversable(j.opts.DataDir, spec.Home); err != nil {
		return nil, err
	}
	if err := chownTree(spec.Home, int(uid), int(uid)); err != nil {
		return nil, fmt.Errorf("cloudhypervisor: jail: chown %s: %w", spec.Home, err)
	}
	for _, p := range spec.OwnPaths {
		if err := ensureTraversable(j.opts.DataDir, filepath.Dir(p)); err != nil {
			return nil, err
		}
		if err := chownTree(p, int(uid), int(uid)); err != nil {
			return nil, fmt.Errorf("cloudhypervisor: jail: chown %s: %w", p, err)
		}
	}
	if spec.KernelPath != "" {
		if err := checkWorldReadable(spec.KernelPath); err != nil {
			return nil, err
		}
	}

	// Resources: one cgroup per sandbox, entered at clone time.
	l.cgroupDir = filepath.Join(j.opts.CgroupRoot, spec.SandboxID)
	if err := os.Mkdir(l.cgroupDir, 0o755); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, fmt.Errorf("cloudhypervisor: jail: create cgroup: %w", err)
	}
	limits := map[string]string{
		"memory.max": strconv.FormatInt(spec.MemoryBytes, 10),
		"pids.max":   strconv.Itoa(j.opts.PidsMax),
	}
	for file, val := range limits {
		if err := os.WriteFile(filepath.Join(l.cgroupDir, file), []byte(val), 0); err != nil {
			return nil, fmt.Errorf("cloudhypervisor: jail: set %s: %w", file, err)
		}
	}
	if l.cgroup, err = os.Open(l.cgroupDir); err != nil {
		return nil, fmt.Errorf("cloudhypervisor: jail: open cgroup: %w", err)
	}

	// Network: root attaches to the TAP; the VMM only inherits the FD.
	if spec.TAPName != "" {
		if l.tap, err = openTAP(spec.TAPName, uid); err != nil {
			return nil, err
		}
	}
	return l, nil
}

// openTAP attaches to an existing (persistent) TAP with the flags Cloud
// Hypervisor itself would use (net_util/src/tap.rs), then makes owner the
// only unprivileged UID allowed to attach to it. Without an owner the kernel
// lets *any* user attach to a free persistent TAP (tun_not_capable), so a
// compromised jailed VMM could grab another sandbox's TAP by name.
func openTAP(name string, owner uint32) (*os.File, error) {
	fd, err := unix.Open("/dev/net/tun", unix.O_RDWR|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, fmt.Errorf("cloudhypervisor: jail: open /dev/net/tun: %w", err)
	}
	ifr, err := unix.NewIfreq(name)
	if err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("cloudhypervisor: jail: TAP name %q: %w", name, err)
	}
	ifr.SetUint16(unix.IFF_TAP | unix.IFF_NO_PI | unix.IFF_VNET_HDR)
	if err := unix.IoctlIfreq(fd, unix.TUNSETIFF, ifr); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("cloudhypervisor: jail: attach TAP %q: %w", name, err)
	}
	if err := unix.IoctlSetInt(fd, unix.TUNSETOWNER, int(owner)); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("cloudhypervisor: jail: set TAP %q owner: %w", name, err)
	}
	return os.NewFile(uintptr(fd), "tap:"+name), nil
}

// apply configures cmd to start as the jail user inside the jail cgroup.
func (l *jailLaunch) apply(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Credential = &syscall.Credential{Uid: l.uid, Gid: l.gid, Groups: l.groups}
	cmd.SysProcAttr.UseCgroupFD = true
	cmd.SysProcAttr.CgroupFD = int(l.cgroup.Fd())
	if l.tap != nil {
		cmd.ExtraFiles = []*os.File{l.tap} // fd 3 in the child (tapFD)
	}
}

// closeParentFDs drops the parent's copies once the child holds its own.
func (l *jailLaunch) closeParentFDs() {
	if l == nil {
		return
	}
	if l.tap != nil {
		_ = l.tap.Close()
		l.tap = nil
	}
	if l.cgroup != nil {
		_ = l.cgroup.Close()
		l.cgroup = nil
	}
}

// cleanup removes the sandbox cgroup (once its processes are gone) and frees
// the UID. Files stay owned by the old UID until the sandbox is deleted; the
// next launch re-chowns them.
func (j *jail) cleanup(sandboxID string) {
	if cgroupNameRE.MatchString(sandboxID) {
		dir := filepath.Join(j.opts.CgroupRoot, sandboxID)
		for i := 0; i < 50; i++ {
			err := os.Remove(dir)
			if err == nil || errors.Is(err, os.ErrNotExist) {
				break
			}
			time.Sleep(20 * time.Millisecond) // processes still exiting
		}
	}
	j.release(sandboxID)
}
