//go:build linux

package cloudhypervisor

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const jailHelperEnv = "FASTVM_JAIL_HELPER"

// TestJailHostileVMM plays a compromised VMM: it prepares a real jail exactly
// as Boot does (per-sandbox UID, kvm group, cgroup, TAP passed as fd 3), but
// launches a helper instead of cloud-hypervisor. The helper reports what it
// can and cannot reach. It needs root, cgroup v2 and /dev/net/tun, but not
// KVM:
//
//	sudo FASTVM_JAIL_TESTS=1 go test -run TestJailHostileVMM -v ./internal/vmm/cloudhypervisor/
//
// Landlock is not exercised here: Cloud Hypervisor applies it to itself after
// it starts, so it only shows up with the real binary.
func TestJailHostileVMM(t *testing.T) {
	if os.Getenv("FASTVM_JAIL_TESTS") == "" {
		t.Skip("set FASTVM_JAIL_TESTS=1 (needs root, cgroup v2 and /dev/net/tun)")
	}
	if os.Geteuid() != 0 {
		t.Skip("needs root")
	}

	// Layout mirrors fastvmd's data dir: two sandboxes, two disks, one
	// root-only file.
	root := t.TempDir()
	for _, d := range []string{filepath.Dir(root), root} {
		if err := os.Chmod(d, 0o711); err != nil {
			t.Fatal(err)
		}
	}
	data := filepath.Join(root, "data")
	homeA := filepath.Join(data, "sandboxes", "sbA")
	homeB := filepath.Join(data, "sandboxes", "sbB")
	diskA := filepath.Join(data, "volumes", "sbA.img")
	diskB := filepath.Join(data, "volumes", "sbB.img")
	secret := filepath.Join(data, "state.db")
	for _, d := range []string{homeA, homeB, filepath.Dir(diskA)} {
		mustMkdir(t, d)
	}
	for p, body := range map[string]string{diskA: "disk-A", diskB: "disk-B", secret: "root-only"} {
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, d := range []string{data, filepath.Join(data, "sandboxes"), filepath.Dir(diskA)} {
		if err := os.Chmod(d, 0o700); err != nil {
			t.Fatal(err)
		}
	}

	// The helper is this test binary; the jail user must be able to exec it.
	helper := filepath.Join(root, "hostile-vmm")
	copyExecutable(t, os.Args[0], helper)

	suffix := strconv.Itoa(os.Getpid() % 100000)
	tapA, tapB, tapFree := "fvjA"+suffix, "fvjB"+suffix, "fvjC"+suffix
	for _, name := range []string{tapA, tapB, tapFree} {
		createTestTAP(t, name)
	}

	cgRoot := "/sys/fs/cgroup/fastvm-vmm-test-" + suffix
	j, err := newJail(JailOptions{
		DataDir: data, UIDBase: 1_900_000_000, UIDCount: 16,
		CgroupRoot: cgRoot, MemoryOverheadMB: 64, PidsMax: 64,
	})
	if err != nil {
		t.Fatalf("newJail: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(cgRoot) })

	// Sandbox B is prepared but its VMM is not running, so its TAP is free
	// (as during a dormant transition) but owned by B's jail UID.
	lB, err := j.prepare(jailSpec{SandboxID: "sbB", Home: homeB, OwnPaths: []string{diskB}, MemoryBytes: 128 << 20, TAPName: tapB})
	if err != nil {
		t.Fatalf("prepare B: %v", err)
	}
	lB.closeParentFDs()
	lA, err := j.prepare(jailSpec{SandboxID: "sbA", Home: homeA, OwnPaths: []string{diskA}, MemoryBytes: 128 << 20, TAPName: tapA})
	if err != nil {
		t.Fatalf("prepare A: %v", err)
	}

	env := func(cmd *exec.Cmd) {
		cmd.Env = append(os.Environ(),
			jailHelperEnv+"=1",
			"FJ_OWN_DISK="+diskA, "FJ_OTHER_DISK="+diskB, "FJ_SECRET="+secret,
			"FJ_DATA="+data, "FJ_HOME="+homeA, "FJ_OTHER_HOME="+homeB,
			"FJ_OTHER_TAP="+tapB, "FJ_FREE_TAP="+tapFree,
		)
	}
	// Baseline: the same "compromised VMM" launched the way fastvmd launches
	// cloud-hypervisor without the jail (root, daemon cgroup, TAP by name).
	base := runHelper(t, helper, filepath.Join(root, "baseline.log"), env)
	for _, k := range []string{"uid", "cap_eff", "read_other_disk", "write_other_home", "read_daemon_state", "read_etc_shadow", "list_data_dir", "attach_unowned_tap", "signal_parent"} {
		t.Logf("baseline (no jail) %-20s = %s", k, base[k])
	}

	got := runHelper(t, helper, filepath.Join(root, "hostile-vmm.log"), lA.apply, env)
	lA.closeParentFDs()

	// Limits as seen by the host, before cleanup removes the cgroup.
	cgA := filepath.Join(cgRoot, "sbA")
	if v := readTrim(t, filepath.Join(cgA, "memory.max")); v != strconv.Itoa(128<<20) {
		t.Errorf("memory.max = %s", v)
	}
	if v := readTrim(t, filepath.Join(cgA, "pids.max")); v != "64" {
		t.Errorf("pids.max = %s", v)
	}
	j.cleanup("sbA")
	j.cleanup("sbB")
	if _, err := os.Stat(cgA); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("cgroup %s not removed: %v", cgA, err)
	}

	want := []struct{ key, value, why string }{
		{"uid", strconv.Itoa(int(lA.uid)), "runs as the per-sandbox jail UID"},
		{"cap_eff", "0000000000000000", "no capabilities at all"},
		{"cgroup_suffix", "/sbA", "starts inside its own cgroup"},
		{"fd3", "/dev/net/tun", "TAP handed over as fd 3"},
		{"read_own_disk", "ok", "can use its own disk"},
		{"write_own_home", "ok", "can write its sandbox dir (sockets, serial, snapshots)"},
		{"read_other_disk", "denied", "cannot read another sandbox's disk"},
		{"write_other_home", "denied", "cannot write another sandbox's dir"},
		{"read_daemon_state", "denied", "cannot read root-only daemon files"},
		{"read_etc_shadow", "denied", "cannot read host secrets"},
		{"list_data_dir", "denied", "can traverse but not list the data dir"},
		{"attach_other_tap", "denied", "cannot hijack another sandbox's TAP (TUNSETOWNER)"},
		{"attach_unowned_tap", "ok", "an unowned persistent TAP is open to anyone: why TUNSETOWNER matters"},
		{"signal_parent", "denied", "cannot signal root processes"},
	}
	for _, w := range want {
		if g := got[w.key]; g != w.value {
			t.Errorf("%-20s = %-18q want %-10q (%s)", w.key, g, w.value, w.why)
		} else {
			t.Logf("%-20s = %-18s (%s)", w.key, g, w.why)
		}
	}
	// Still reachable in step 1; closed by Landlock (files) and namespaces
	// (processes, network) later. Logged, not asserted.
	for _, k := range []string{"read_etc_passwd", "read_host_proc"} {
		t.Logf("%-20s = %-18s (still possible in step 1, see docs/VMM_JAIL.md)", k, got[k])
	}
}

// TestJailHelperProcess is the "compromised VMM". It only runs when launched
// by TestJailHostileVMM and prints one JSON report line.
func TestJailHelperProcess(t *testing.T) {
	if os.Getenv(jailHelperEnv) == "" {
		t.Skip("helper process for TestJailHostileVMM")
	}
	r := map[string]string{}
	result := func(err error) string {
		switch {
		case err == nil:
			return "ok"
		case errors.Is(err, fs.ErrPermission), errors.Is(err, syscall.EPERM), errors.Is(err, syscall.EACCES):
			return "denied"
		default:
			return "error: " + err.Error()
		}
	}
	read := func(p string) error { _, err := os.ReadFile(p); return err }

	r["uid"] = strconv.Itoa(os.Getuid())
	if status, err := os.ReadFile("/proc/self/status"); err == nil {
		for _, line := range strings.Split(string(status), "\n") {
			if v, ok := strings.CutPrefix(line, "CapEff:"); ok {
				r["cap_eff"] = strings.TrimSpace(v)
			}
		}
	}
	if cg, err := os.ReadFile("/proc/self/cgroup"); err == nil {
		s := strings.TrimSpace(string(cg))
		r["cgroup_suffix"] = s[strings.LastIndex(s, "/"):]
	}
	r["fd3"], _ = os.Readlink("/proc/self/fd/3")
	r["read_own_disk"] = result(read(os.Getenv("FJ_OWN_DISK")))
	probe := fmt.Sprintf("probe-uid-%d", os.Getuid()) // one per run: the baseline runs as root first
	r["write_own_home"] = result(os.WriteFile(filepath.Join(os.Getenv("FJ_HOME"), probe), nil, 0o600))
	r["read_other_disk"] = result(read(os.Getenv("FJ_OTHER_DISK")))
	r["write_other_home"] = result(os.WriteFile(filepath.Join(os.Getenv("FJ_OTHER_HOME"), probe), nil, 0o600))
	r["read_daemon_state"] = result(read(os.Getenv("FJ_SECRET")))
	r["read_etc_shadow"] = result(read("/etc/shadow"))
	_, err := os.ReadDir(os.Getenv("FJ_DATA"))
	r["list_data_dir"] = result(err)
	r["attach_other_tap"] = result(attachTAP(os.Getenv("FJ_OTHER_TAP")))
	r["attach_unowned_tap"] = result(attachTAP(os.Getenv("FJ_FREE_TAP")))
	r["signal_parent"] = result(syscall.Kill(os.Getppid(), 0))
	r["read_etc_passwd"] = result(read("/etc/passwd"))
	r["read_host_proc"] = result(read("/proc/1/cmdline"))

	out, _ := json.Marshal(r)
	fmt.Println(string(out))
}

// runHelper starts the hostile helper with the given launch hooks and returns
// its report.
func runHelper(t *testing.T, helper, logPath string, hooks ...func(*exec.Cmd)) map[string]string {
	t.Helper()
	proc, err := startProcess(helper, []string{"-test.run=^TestJailHelperProcess$"}, logPath, hooks...)
	if err != nil {
		t.Fatalf("start helper: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := proc.wait(ctx); err != nil {
		t.Fatalf("helper: %v\n%s", err, logTail(logPath, 4096))
	}
	return readHelperReport(t, logPath)
}

func attachTAP(name string) error {
	fd, err := unix.Open("/dev/net/tun", unix.O_RDWR|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	ifr, err := unix.NewIfreq(name)
	if err != nil {
		return err
	}
	ifr.SetUint16(unix.IFF_TAP | unix.IFF_NO_PI | unix.IFF_VNET_HDR)
	return unix.IoctlIfreq(fd, unix.TUNSETIFF, ifr)
}

// createTestTAP creates an unowned persistent TAP, like fastvm's network
// manager does, and deletes it when the test ends.
func createTestTAP(t *testing.T, name string) {
	t.Helper()
	setPersist := func(on int) error {
		fd, err := unix.Open("/dev/net/tun", unix.O_RDWR|unix.O_CLOEXEC, 0)
		if err != nil {
			return err
		}
		defer unix.Close(fd)
		ifr, err := unix.NewIfreq(name)
		if err != nil {
			return err
		}
		ifr.SetUint16(unix.IFF_TAP | unix.IFF_NO_PI)
		if err := unix.IoctlIfreq(fd, unix.TUNSETIFF, ifr); err != nil {
			return err
		}
		return unix.IoctlSetInt(fd, unix.TUNSETPERSIST, on)
	}
	if err := setPersist(1); err != nil {
		t.Skipf("cannot create TAP %s (needs CAP_NET_ADMIN and /dev/net/tun): %v", name, err)
	}
	t.Cleanup(func() { _ = setPersist(0) })
}

func readHelperReport(t *testing.T, logPath string) map[string]string {
	t.Helper()
	f, err := os.Open(logPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if line := sc.Text(); strings.HasPrefix(line, "{") {
			var r map[string]string
			if err := json.Unmarshal([]byte(line), &r); err != nil {
				t.Fatalf("parse helper report: %v", err)
			}
			return r
		}
	}
	t.Fatalf("no report from helper:\n%s", logTail(logPath, 4096))
	return nil
}

func copyExecutable(t *testing.T, src, dst string) {
	t.Helper()
	in, err := os.Open(src)
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(out, in); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
}

func mustMkdir(t *testing.T, d string) {
	t.Helper()
	if err := os.MkdirAll(d, 0o700); err != nil {
		t.Fatal(err)
	}
}

func readTrim(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(b))
}
