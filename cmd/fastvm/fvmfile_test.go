package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFVMFile(t *testing.T, dir, name, body string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadFVMFile(t *testing.T) {
	t.Setenv("FVM_TEST_TOKEN", "secret-value")
	dir := t.TempDir()
	path := writeFVMFile(t, dir, "codex.fvmfile", `
version: 1
name: codex
image: node:26-slim
entrypoint: ["/usr/local/bin/codex"]
command: ["--help"]
env:
  TOKEN: "${FVM_TEST_TOKEN}"
volumes:
  - host: ./project
    guest: /workspace
    read_only: true
ports:
  - host: 8080
    guest: 80
    protocol: tcp
network:
  allow_hosts: [api.openai.com]
resources:
  vcpus: 4
  memory_mb: 4096
no_auto_sleep: true
`)
	spec, err := LoadFVMFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if spec.Name != "codex" || spec.Image != "node:26-slim" {
		t.Fatalf("spec = %+v", spec)
	}
	if len(spec.Entrypoint) != 1 || spec.Entrypoint[0] != "/usr/local/bin/codex" || len(spec.Command) != 1 || spec.Command[0] != "--help" {
		t.Fatalf("entrypoint/command = %v/%v", spec.Entrypoint, spec.Command)
	}
	if spec.Env["TOKEN"] != "secret-value" {
		t.Errorf("env not expanded: %v", spec.Env)
	}
	if len(spec.Volumes) != 1 || spec.Volumes[0].HostPath != filepath.Join(dir, "project") || !spec.Volumes[0].ReadOnly {
		t.Errorf("volumes = %+v", spec.Volumes)
	}
	if !spec.NetworkEnabled || len(spec.AllowHosts) != 1 {
		t.Errorf("network = %v %v", spec.NetworkEnabled, spec.AllowHosts)
	}
	if spec.VCPUs != 4 || spec.MemoryMB != 4096 || !spec.NoAutoSleep {
		t.Errorf("resources = %+v", spec)
	}
}

func TestLoadFVMFileDefaultsNameAndNetwork(t *testing.T) {
	dir := t.TempDir()
	path := writeFVMFile(t, dir, "plain.fvmfile", "image: alpine\n")
	spec, err := LoadFVMFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if spec.Name != "plain" || spec.NetworkEnabled {
		t.Errorf("spec = %+v", spec)
	}
}

func TestLoadFVMFileRejectsUnknownField(t *testing.T) {
	dir := t.TempDir()
	path := writeFVMFile(t, dir, "bad.fvmfile", "image: alpine\nimagee: typo\n")
	_, err := LoadFVMFile(path)
	if err == nil || !strings.Contains(err.Error(), "field imagee not found") {
		t.Fatalf("err = %v", err)
	}
}

func TestLoadFVMFileRejectsMissingEnv(t *testing.T) {
	dir := t.TempDir()
	path := writeFVMFile(t, dir, "secret.fvmfile", "image: alpine\nenv:\n  TOKEN: ${FVM_UNSET_TOKEN}\n")
	_, err := LoadFVMFile(path)
	if err == nil || !strings.Contains(err.Error(), "FVM_UNSET_TOKEN") {
		t.Fatalf("err = %v", err)
	}
}

func TestLoadFVMFilePortsImplyNetwork(t *testing.T) {
	dir := t.TempDir()
	path := writeFVMFile(t, dir, "web.fvmfile", "image: busybox\nports:\n  - host: 8080\n    guest: 80\n")
	spec, err := LoadFVMFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !spec.NetworkEnabled || len(spec.Ports) != 1 {
		t.Fatalf("spec = %+v", spec)
	}
}

func TestLoadFVMFileUserData(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "setup.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho installed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	inline := writeFVMFile(t, dir, "inline.fvmfile", "image: node:26-slim\nuser_data: |\n  #!/bin/sh\n  echo inline\n")
	spec, err := LoadFVMFile(inline)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(spec.UserData, "echo inline") {
		t.Fatalf("inline user_data = %q", spec.UserData)
	}
	fromFile := writeFVMFile(t, dir, "file.fvmfile", "image: node:26-slim\nuser_data_file: setup.sh\n")
	spec, err = LoadFVMFile(fromFile)
	if err != nil {
		t.Fatal(err)
	}
	if spec.UserData != "#!/bin/sh\necho installed\n" {
		t.Fatalf("file user_data = %q", spec.UserData)
	}
}

func TestLoadFVMFileRejectsBothUserDataForms(t *testing.T) {
	dir := t.TempDir()
	path := writeFVMFile(t, dir, "both.fvmfile", "image: alpine\nuser_data: echo hi\nuser_data_file: setup.sh\n")
	_, err := LoadFVMFile(path)
	if err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("err = %v", err)
	}
}

func TestResolveWorkload(t *testing.T) {
	tests := []struct {
		name       string
		entrypoint []string
		command    []string
		cli        []string
		want       []string
	}{
		{name: "command only", command: []string{"sleep", "10"}, want: []string{"sleep", "10"}},
		{name: "cli overrides command", command: []string{"sleep", "10"}, cli: []string{"sh"}, want: []string{"sh"}},
		{name: "entrypoint only", entrypoint: []string{"codex"}, want: []string{"codex"}},
		{name: "entrypoint plus default command", entrypoint: []string{"codex"}, command: []string{"--help"}, want: []string{"codex", "--help"}},
		{name: "entrypoint plus cli args", entrypoint: []string{"codex"}, command: []string{"--help"}, cli: []string{"exec"}, want: []string{"codex", "exec"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveWorkload(tc.entrypoint, tc.command, tc.cli)
			if strings.Join(got, "\x00") != strings.Join(tc.want, "\x00") {
				t.Fatalf("resolveWorkload = %v, want %v", got, tc.want)
			}
		})
	}
}
