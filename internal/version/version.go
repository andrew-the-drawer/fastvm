// Package version reports the fastvm build identity.
//
// The Makefile injects the nearest git tag or short commit via
// -X fastvm/internal/version.version=... and appends -dirty when the worktree
// is dirty. Plain `go build` falls back to the VCS metadata Go embeds in the
// binary, so development builds still report a commit and dirty state.
package version

import (
	"runtime/debug"
	"strings"
)

// Injected at build time with -ldflags. Keep the name short: the linker's -X
// flag needs the fully-qualified package path.
var version = ""

// String returns the build version: a tag/commit, optionally suffixed -dirty.
func String() string {
	if v := strings.TrimSpace(version); v != "" {
		return strings.TrimPrefix(v, "v")
	}
	return fromBuildInfo()
}

func fromBuildInfo() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	var (
		revision string
		modified bool
	)
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.modified":
			modified = setting.Value == "true"
		}
	}
	if revision == "" {
		return "dev"
	}
	if len(revision) > 7 {
		revision = revision[:7]
	}
	if modified {
		revision += "-dirty"
	}
	return revision
}
