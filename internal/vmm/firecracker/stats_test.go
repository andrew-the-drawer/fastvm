package firecracker

import (
	"os/exec"
	"testing"
	"time"
)

func TestParseProcStat(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		utime   uint64
		stime   uint64
		wantErr bool
	}{
		{
			name:  "normal",
			line:  "1234 (firecracker) S 1 1234 1234 0 -1 4194304 100 0 0 0 42 7 0 0 20 0 1 0 1000 1000000 100 18446744073709551615",
			utime: 42,
			stime: 7,
		},
		{
			name:  "comm with spaces and parens",
			line:  "1234 (my vmm (v1)) R 1 1234 1234 0 -1 4194304 100 0 0 0 11 3 0 0 20 0 1 0 1000 1000000 100 0",
			utime: 11,
			stime: 3,
		},
		{name: "missing comm terminator", line: "1234 firecracker R 1", wantErr: true},
		{name: "too few fields", line: "1234 (fc) S 1 1234", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			utime, stime, err := parseProcStat(tc.line)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseProcStat: %v", err)
			}
			if utime != tc.utime || stime != tc.stime {
				t.Fatalf("got utime=%d stime=%d, want utime=%d stime=%d", utime, stime, tc.utime, tc.stime)
			}
		})
	}
}

func TestParseProcStatusRSS(t *testing.T) {
	body := "Name:\tfirecracker\n" +
		"Umask:\t0022\n" +
		"State:\tS (sleeping)\n" +
		"VmPeak:\t 1048576 kB\n" +
		"VmSize:\t  512000 kB\n" +
		"VmRSS:\t  102400 kB\n" +
		"VmData:\t   10000 kB\n" +
		"Threads:\t7\n"
	got, err := parseProcStatusRSS(body)
	if err != nil {
		t.Fatalf("parseProcStatusRSS: %v", err)
	}
	if want := uint64(102400 * 1024); got != want {
		t.Fatalf("RSS = %d, want %d", got, want)
	}

	tests := []struct {
		name string
		body string
	}{
		{name: "missing VmRSS", body: "Name:\tfirecracker\nVmSize:\t 1024 kB\n"},
		{name: "empty body", body: ""},
		{name: "not a number", body: "VmRSS:\t lots kB\n"},
		{name: "missing unit", body: "VmRSS:\t 102400\n"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parseProcStatusRSS(tc.body); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestReadVMStatsBusyProcess(t *testing.T) {
	// A shell busy-loop must accumulate USER_HZ ticks within the timeout.
	cmd := exec.Command("/bin/sh", "-c", "i=0; while :; do i=$((i+1)); done")
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot start shell: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	deadline := time.Now().Add(5 * time.Second)
	for {
		st, err := readVMStats(cmd.Process.Pid)
		if err != nil {
			t.Fatalf("readVMStats: %v", err)
		}
		if st.VCPUTimeNS > 0 {
			// A live shell must report resident memory; /proc/<pid>/status
			// always carries VmRSS for a running process.
			if st.MemoryRSSBytes == 0 {
				t.Fatal("live process reported VmRSS = 0")
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("busy process CPU time never advanced")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestReadVMStatsExitedProcess(t *testing.T) {
	cmd := exec.Command("/bin/true")
	if err := cmd.Run(); err != nil {
		t.Fatalf("/bin/true: %v", err)
	}
	if _, err := readVMStats(cmd.Process.Pid); err == nil {
		t.Fatal("expected error reading stats of an exited process")
	}
}

func TestVMMBlockIOExitedProcess(t *testing.T) {
	cmd := exec.Command("/bin/true")
	if err := cmd.Run(); err != nil {
		t.Fatalf("/bin/true: %v", err)
	}
	if _, _, err := vmmBlockIO(cmd.Process.Pid); err == nil {
		t.Fatal("expected error reading /proc/<pid>/io of an exited process")
	}
}
