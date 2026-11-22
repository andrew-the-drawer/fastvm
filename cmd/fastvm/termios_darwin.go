package main

import "golang.org/x/sys/unix"

// Terminal attribute ioctls for the interactive shell (macOS/BSD naming), so a
// native fastvmctl can drive a daemon running in a Linux VM (docs/MACOS.md).
const (
	ioctlGetTermios = unix.TIOCGETA
	ioctlSetTermios = unix.TIOCSETA
)
