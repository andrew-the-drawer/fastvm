package main

import "golang.org/x/sys/unix"

// Terminal attribute ioctls for the interactive shell (Linux).
const (
	ioctlGetTermios = unix.TCGETS
	ioctlSetTermios = unix.TCSETS
)
