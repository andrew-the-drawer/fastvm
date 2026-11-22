package agent

import (
	"encoding/hex"
	"testing"
)

func TestParseSeedFromCmdline(t *testing.T) {
	seed := []byte("0123456789abcdef0123456789abcdef")
	cmdline := "console=ttyS0 root=/dev/vda rw init=/init fastvm.seed=" + hex.EncodeToString(seed)

	got, err := parseSeed(cmdline)
	if err != nil {
		t.Fatalf("parseSeed: %v", err)
	}
	if string(got) != string(seed) {
		t.Fatalf("seed = %x, want %x", got, seed)
	}

	if got, err := parseSeed("console=ttyS0 fastvm.ip=10.0.0.2/30"); err != nil || len(got) != 0 {
		t.Fatalf("unexpected seed without key: %x, %v", got, err)
	}
	if _, err := parseSeed("fastvm.seed=not-hex"); err == nil {
		t.Fatal("expected hex decode error")
	}
}

func TestValidateReseedBounds(t *testing.T) {
	for _, tc := range []struct {
		n    int
		ok   bool
		name string
	}{
		{0, false, "empty"},
		{minReseedBytes - 1, false, "too short"},
		{minReseedBytes, true, "minimum"},
		{32, true, "daemon default"},
		{maxReseedBytes, true, "maximum"},
		{maxReseedBytes + 1, false, "too long"},
	} {
		err := validateReseed(make([]byte, tc.n))
		if (err == nil) != tc.ok {
			t.Errorf("%s (%d bytes): err = %v, want ok=%t", tc.name, tc.n, err, tc.ok)
		}
	}
}

// reseedFromHost must reject bad input before it opens /dev/urandom, so an
// invalid request from the host can never reach the kernel ioctls.
func TestReseedFromHostRejectsBeforeKernel(t *testing.T) {
	if err := reseedFromHost(nil); err == nil {
		t.Fatal("expected error for empty seed")
	}
}
