package main

import "testing"

func TestAPITargetUnixByDefault(t *testing.T) {
	t.Setenv("FASTVM_HOST", "")
	old := socketFlag
	socketFlag = ""
	t.Cleanup(func() { socketFlag = old })
	base, _, err := apiTarget()
	if err != nil {
		t.Fatal(err)
	}
	if base != "" {
		t.Fatalf("base = %q, want unix", base)
	}
}

func TestAPITargetRequiresHTTPS(t *testing.T) {
	old := socketFlag
	socketFlag = ""
	t.Cleanup(func() { socketFlag = old })
	t.Setenv("FASTVM_HOST", "http://127.0.0.1:8443")
	if _, _, err := apiTarget(); err == nil {
		t.Fatal("expected non-HTTPS error")
	}
}

func TestAPITargetRequiresClientCert(t *testing.T) {
	old := socketFlag
	socketFlag = ""
	t.Cleanup(func() { socketFlag = old })
	t.Setenv("FASTVM_HOST", "https://127.0.0.1:8443")
	t.Setenv("FASTVM_CERT_PATH", "")
	if _, _, err := apiTarget(); err == nil {
		t.Fatal("expected missing client cert error")
	}
}

func TestSocketFlagOverridesBaseURL(t *testing.T) {
	old := socketFlag
	socketFlag = "/tmp/fastvm.sock"
	t.Cleanup(func() { socketFlag = old })
	t.Setenv("FASTVM_HOST", "https://127.0.0.1:8443")
	base, _, err := apiTarget()
	if err != nil {
		t.Fatal(err)
	}
	if base != "" {
		t.Fatalf("base = %q, want socket override", base)
	}
}

func TestAPITargetAcceptsHostWithoutScheme(t *testing.T) {
	old := socketFlag
	socketFlag = ""
	t.Cleanup(func() { socketFlag = old })
	t.Setenv("FASTVM_HOST", "127.0.0.1:8443")
	t.Setenv("FASTVM_CERT_PATH", t.TempDir())
	base, _, err := apiTarget()
	if err == nil {
		t.Fatalf("expected missing cert files error, base=%q", base)
	}
}
