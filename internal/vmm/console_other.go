//go:build !arm64

package vmm

// GuestConsole is the guest device behind the VMM's serial port: the 8250 UART
// Cloud Hypervisor emulates on x86_64.
const GuestConsole = "ttyS0"
