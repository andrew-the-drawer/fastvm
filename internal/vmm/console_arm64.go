package vmm

// GuestConsole is the guest device behind the VMM's serial port. Cloud
// Hypervisor emulates a PL011 UART on arm64 (e.g. fastvm inside a Lima VM on
// Apple Silicon, docs/MACOS.md).
const GuestConsole = "ttyAMA0"
