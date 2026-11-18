package main

import "testing"

func TestRandomSuffix(t *testing.T) {
	a, b := randomSuffix(), randomSuffix()
	if len(a) < 6 {
		t.Errorf("suffix too short: %q", a)
	}
	if a == b {
		t.Errorf("suffix collision: %q", a)
	}
}
