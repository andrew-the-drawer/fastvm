package vmm

// BaseCmdline is the guest kernel cmdline prefix every fastvm boot uses: the
// serial console the VMM captures to serial.log, the CoW root disk, and the
// injected agent as PID 1.
func BaseCmdline() string {
	return "console=" + GuestConsole + " root=/dev/vda rw init=/init"
}
