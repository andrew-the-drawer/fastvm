package network

import (
	"errors"
	"fmt"
	"net"
	"os"

	"github.com/vishvananda/netlink"
	"golang.org/x/sys/unix"
)

// guestRulePriority must sort before VPN policy rules (for example Tailscale's
// table-52 rule) so traffic to the sandbox CIDR keeps using the main table.
const guestRulePriority = 100

// ensureGuestCIDRRule keeps sandbox addresses out of host VPN policy routing.
// Without this, a host route such as 10.0.0.0/8 dev tailscale0 can capture
// 10.77.0.0/16, so host-local published-port traffic is sent to the VPN instead
// of the fastvm bridge.
func ensureGuestCIDRRule(cidr string) error {
	if os.Geteuid() != 0 {
		return nil
	}
	_, dst, err := net.ParseCIDR(cidr)
	if err != nil {
		return fmt.Errorf("network: parse guest CIDR %q: %w", cidr, err)
	}
	rules, err := netlink.RuleList(unix.AF_INET)
	if err == nil {
		for _, r := range rules {
			if r.Dst != nil && r.Dst.String() == dst.String() &&
				r.Table == unix.RT_TABLE_MAIN && r.Priority == guestRulePriority {
				return nil
			}
		}
	}
	rule := netlink.NewRule()
	rule.Family = unix.AF_INET
	rule.Dst = dst
	rule.Table = unix.RT_TABLE_MAIN
	rule.Priority = guestRulePriority
	if err := netlink.RuleAdd(rule); err != nil && !errors.Is(err, unix.EEXIST) {
		return fmt.Errorf("network: add guest CIDR routing rule: %w", err)
	}
	return nil
}
