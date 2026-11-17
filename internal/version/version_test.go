package version

import (
	"strings"
	"testing"
)

func TestString(t *testing.T) {
	got := String()
	if got == "" {
		t.Fatal("version must not be empty")
	}
	if after, ok := strings.CutPrefix(got, "v"); ok {
		t.Fatalf("version %q must not have a leading v", after)
	}
}
