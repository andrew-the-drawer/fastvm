package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sort"
	"time"

	"fastvm/internal/types"
)

const autoPublishInterval = 1 * time.Second

// autoPublishLoop periodically discovers guest TCP listeners and maps each one
// 1:1 onto the same loopback host port. Occupied host ports are skipped (with a
// warning) and retried later; they are never reassigned to another port.
func (d *Daemon) autoPublishLoop(rt *runtime) {
	defer d.wg.Done()
	ticker := time.NewTicker(autoPublishInterval)
	defer ticker.Stop()
	for {
		select {
		case <-rt.done:
			return
		case <-ticker.C:
			d.reconcileAutoPorts(rt)
		}
	}
}

func (d *Daemon) reconcileAutoPorts(rt *runtime) {
	rt.mu.Lock()
	if rt.closed {
		rt.mu.Unlock()
		return
	}
	if rt.sb.State != types.StateRunning && rt.sb.State != types.StateIdle {
		rt.mu.Unlock()
		return
	}
	ac := rt.ac
	sb := &rt.sb
	rt.mu.Unlock()
	if ac == nil {
		return
	}
	ports, err := ac.Ports(context.Background())
	if err != nil {
		rt.mu.Lock()
		warned := rt.autoWarned
		rt.autoWarned = true
		rt.mu.Unlock()
		if !warned {
			d.log.Warn("auto-publish: guest port discovery failed", "sandbox", sb.ID, "err", err)
		}
		return
	}

	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.closed || (sb.State != types.StateRunning && sb.State != types.StateIdle) {
		return
	}
	if rt.autoHost == nil {
		rt.autoHost = make(map[int]int)
	}
	if rt.autoWarnedPorts == nil {
		rt.autoWarnedPorts = make(map[int]bool)
	}
	desired := append([]types.PortMapping(nil), rt.autoBase...)
	explicitGuest := make(map[int]bool, len(rt.autoBase))
	for _, p := range rt.autoBase {
		if p.Proto == "tcp" {
			explicitGuest[p.GuestPort] = true
		}
	}
	nextHost := make(map[int]int, len(ports))
	for _, guest := range ports {
		if guest < 1 || guest > 65535 || explicitGuest[guest] {
			continue
		}
		for _, p := range rt.autoBase {
			if p.HostPort == guest && p.Proto == "tcp" {
				explicitGuest[guest] = true
				break
			}
		}
		if explicitGuest[guest] {
			continue
		}
		host, ok := rt.autoHost[guest]
		if !ok {
			if !d.tryReserveAutoPort(context.Background(), sb.ID, guest) {
				if !rt.autoWarnedPorts[guest] {
					rt.autoWarnedPorts[guest] = true
					d.log.Warn("auto-publish: host port in use; skipping 1:1 mapping",
						"sandbox", sb.ID, "port", guest)
					d.event(context.Background(), sb.ID, "warning",
						fmt.Sprintf("auto-publish: host port %d is in use; mapping will be retried", guest))
				}
				continue
			}
			host = guest
		}
		nextHost[guest] = host
		desired = append(desired, types.PortMapping{HostPort: host, GuestPort: guest, Proto: "tcp"})
	}
	oldHost := rt.autoHost
	for guest, host := range oldHost {
		if _, ok := nextHost[guest]; !ok {
			d.releaseAutoPort(host)
		}
	}
	rt.autoHost = nextHost
	// Auto mappings are loopback-only.
	for i := range desired {
		if i >= len(rt.autoBase) {
			desired[i].LoopbackOnly = true
		}
	}
	sort.Slice(desired, func(i, j int) bool {
		if desired[i].Proto != desired[j].Proto {
			return desired[i].Proto < desired[j].Proto
		}
		if desired[i].HostPort != desired[j].HostPort {
			return desired[i].HostPort < desired[j].HostPort
		}
		return desired[i].GuestPort < desired[j].GuestPort
	})
	if equalPorts(sb.Ports, desired) {
		return
	}
	if err := d.net.SetPorts(context.Background(), sb.ID, desired); err != nil {
		d.log.Warn("auto-publish: update port mappings failed", "sandbox", sb.ID, "err", err)
		return
	}
	sb.Ports = desired
	if err := d.persistLocked(context.Background(), rt, sb); err != nil {
		d.log.Warn("auto-publish: persist ports failed", "sandbox", sb.ID, "err", err)
	}
	for guest, host := range nextHost {
		if _, ok := oldHost[guest]; !ok {
			d.event(context.Background(), sb.ID, "port",
				fmt.Sprintf("auto-publish: mapped guest port %d to 127.0.0.1:%d", guest, host))
		}
	}
	for guest, host := range oldHost {
		if _, ok := nextHost[guest]; !ok {
			d.event(context.Background(), sb.ID, "port",
				fmt.Sprintf("auto-publish: unmapped guest port %d from 127.0.0.1:%d", guest, host))
		}
	}
}

// tryReserveAutoPort reserves the guest port for a 1:1 host mapping if the
// host port is free and not already published by another sandbox.
func (d *Daemon) tryReserveAutoPort(ctx context.Context, sandboxID string, port int) bool {
	d.autoMu.Lock()
	defer d.autoMu.Unlock()
	if d.autoReserved[port] {
		return false
	}
	if !hostTCPPortFree(port) {
		return false
	}
	sandboxes, err := d.st.ListSandboxes(ctx)
	if err != nil {
		return false
	}
	for _, sb := range sandboxes {
		if sb.ID == sandboxID {
			continue
		}
		for _, p := range sb.Ports {
			if p.HostPort == port && p.Proto == "tcp" {
				return false
			}
		}
	}
	d.autoReserved[port] = true
	return true
}

func hostTCPPortFree(port int) bool {
	ln, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func (d *Daemon) releaseAutoPort(port int) {
	d.autoMu.Lock()
	delete(d.autoReserved, port)
	d.autoMu.Unlock()
}

func (d *Daemon) releaseAutoPortsLocked(rt *runtime) {
	hosts := rt.autoHost
	rt.autoHost = make(map[int]int)
	for _, host := range hosts {
		d.releaseAutoPort(host)
	}
}

func equalPorts(a, b []types.PortMapping) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

var _ = slog.LevelInfo
