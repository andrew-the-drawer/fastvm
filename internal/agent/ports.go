package agent

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
)

// listeningPorts returns TCP ports listening on non-loopback addresses in the
// guest. It reads /proc/net/tcp and /proc/net/tcp6 directly; no guest tools are
// required. Loopback-only services are excluded because host DNAT targets the
// guest IP and could not reach them.
func listeningPorts() ([]int, error) {
	seen := make(map[int]struct{})
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		ports, err := parseProcNetTCP(f)
		_ = f.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		for _, p := range ports {
			seen[p] = struct{}{}
		}
	}
	out := make([]int, 0, len(seen))
	for p := range seen {
		out = append(out, p)
	}
	sort.Ints(out)
	return out, nil
}

// parseProcNetTCP parses the Linux /proc/net/tcp{,6} format. A listener is
// state 0A with a non-loopback local address.
func parseProcNetTCP(r io.Reader) ([]int, error) {
	var out []int
	sc := bufio.NewScanner(r)
	first := true
	for sc.Scan() {
		if first {
			first = false
			continue
		}
		fields := strings.Fields(sc.Text())
		if len(fields) < 4 || fields[3] != "0A" {
			continue
		}
		addrHex, portHex, ok := strings.Cut(fields[1], ":")
		if !ok {
			continue
		}
		port, err := strconv.ParseUint(portHex, 16, 16)
		if err != nil || port == 0 {
			continue
		}
		ip, ok := parseProcAddr(addrHex)
		if !ok || ip.IsLoopback() {
			continue
		}
		out = append(out, int(port))
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// parseProcAddr parses the little-endian IPv4/IPv6 address encoding used by
// /proc/net/tcp{,6}.
func parseProcAddr(s string) (net.IP, bool) {
	switch len(s) {
	case 8: // IPv4, 32-bit little-endian
		n, err := strconv.ParseUint(s, 16, 32)
		if err != nil {
			return nil, false
		}
		return net.IPv4(byte(n), byte(n>>8), byte(n>>16), byte(n>>24)), true
	case 32: // IPv6, four 32-bit little-endian words
		ip := make(net.IP, net.IPv6len)
		for i := 0; i < 4; i++ {
			n, err := strconv.ParseUint(s[i*8:(i+1)*8], 16, 32)
			if err != nil {
				return nil, false
			}
			ip[i*4] = byte(n)
			ip[i*4+1] = byte(n >> 8)
			ip[i*4+2] = byte(n >> 16)
			ip[i*4+3] = byte(n >> 24)
		}
		return ip, true
	default:
		return nil, false
	}
}
