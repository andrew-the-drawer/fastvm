//go:build linux

package agent

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"unsafe"

	"golang.org/x/sys/unix"
)

// CmdlineSeedKey is the kernel-cmdline key carrying a host-generated entropy
// seed. The daemon passes fresh random bytes on every cold boot, and the agent
// credits them to the guest kernel's random pool. Without this, getrandom() in
// a fresh microVM can block until the CRNG initializes (no virtio-rng device in
// the current device model), which makes tools like coding agents hang.
const CmdlineSeedKey = "fastvm.seed"

// SeedEntropyFromCmdline parses /proc/cmdline and credits the fastvm.seed value
// to the kernel random pool.
func SeedEntropyFromCmdline() (bool, error) {
	data, err := os.ReadFile("/proc/cmdline")
	if err != nil {
		return false, fmt.Errorf("read /proc/cmdline: %w", err)
	}
	seed, err := parseSeed(string(data))
	if err != nil {
		return false, err
	}
	if len(seed) == 0 {
		return false, nil
	}
	if err := addEntropy(seed); err != nil {
		return false, err
	}
	return true, nil
}

func parseSeed(cmdline string) ([]byte, error) {
	for _, field := range strings.Fields(cmdline) {
		value, ok := strings.CutPrefix(field, CmdlineSeedKey+"=")
		if !ok {
			continue
		}
		seed, err := hex.DecodeString(value)
		if err != nil {
			return nil, fmt.Errorf("invalid %s: %w", CmdlineSeedKey, err)
		}
		return seed, nil
	}
	return nil, nil
}

// addEntropy credits seed bytes to the kernel random pool via RNDADDENTROPY.
func addEntropy(seed []byte) error {
	f, err := os.OpenFile("/dev/urandom", os.O_RDWR, 0)
	if err != nil {
		return fmt.Errorf("open /dev/urandom: %w", err)
	}
	defer f.Close()

	// struct rand_pool_info { int entropy_count; int buf_size; __u8 buf[]; }
	buf := make([]byte, 8+len(seed))
	binary.LittleEndian.PutUint32(buf[0:4], uint32(len(seed)*8))
	binary.LittleEndian.PutUint32(buf[4:8], uint32(len(seed)))
	copy(buf[8:], seed)
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, f.Fd(), unix.RNDADDENTROPY, uintptr(unsafe.Pointer(&buf[0])))
	if errno != 0 {
		return fmt.Errorf("RNDADDENTROPY: %w", errno)
	}
	return nil
}

// Reseed seed bounds. 32 bytes (256 bits) is what the daemon sends; the upper
// bound keeps a single request from pushing an arbitrarily large buffer into
// the kernel.
const (
	minReseedBytes = 16
	maxReseedBytes = 512
)

// validateReseed checks a host-supplied reseed buffer without touching the
// kernel, so the bounds are unit-testable without CAP_SYS_ADMIN.
func validateReseed(seed []byte) error {
	if len(seed) < minReseedBytes {
		return fmt.Errorf("reseed: need at least %d bytes, got %d", minReseedBytes, len(seed))
	}
	if len(seed) > maxReseedBytes {
		return fmt.Errorf("reseed: at most %d bytes allowed, got %d", maxReseedBytes, len(seed))
	}
	return nil
}

// reseedFromHost handles OpReseed after a snapshot restore.
//
// Every VM restored from one memory image wakes up with the same kernel CRNG
// state. Cloud Hypervisor's VM Generation ID device lets a CONFIG_VMGENID guest
// reseed on its own; this is the agent-side fallback for guests or VMMs
// without it (see docs/SNAPSHOT_RNG.md).
//
// RNDADDENTROPY alone is not enough: once the CRNG is initialized, the kernel
// only folds the input pool into the CRNG on its periodic reseed schedule
// (up to a minute). RNDRESEEDCRNG forces that fold immediately, so the next
// getrandom()/dev/urandom read already depends on the new bytes.
func reseedFromHost(seed []byte) error {
	if err := validateReseed(seed); err != nil {
		return err
	}
	if err := addEntropy(seed); err != nil {
		return err
	}
	f, err := os.OpenFile("/dev/urandom", os.O_RDWR, 0)
	if err != nil {
		return fmt.Errorf("open /dev/urandom: %w", err)
	}
	defer f.Close()
	if _, _, errno := unix.Syscall(unix.SYS_IOCTL, f.Fd(), unix.RNDRESEEDCRNG, 0); errno != 0 {
		return fmt.Errorf("RNDRESEEDCRNG: %w", errno)
	}
	return nil
}
