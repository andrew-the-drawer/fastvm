//go:build !linux

package cloudhypervisor

import (
	"errors"
	"os"
	"os/exec"
)

var errJailUnsupported = errors.New("cloudhypervisor: the VMM jail requires Linux")

func newJail(JailOptions) (*jail, error) { return nil, errJailUnsupported }

type jailSpec struct {
	SandboxID   string
	Home        string
	OwnPaths    []string
	KernelPath  string
	MemoryBytes int64
	TAPName     string
}

type jailLaunch struct {
	sandboxID string
	uid, gid  uint32
	tap       *os.File
}

func (j *jail) prepare(jailSpec) (*jailLaunch, error) { return nil, errJailUnsupported }
func (l *jailLaunch) apply(*exec.Cmd)                 {}
func (l *jailLaunch) closeParentFDs()                 {}
func (j *jail) cleanup(sandboxID string)              { j.release(sandboxID) }
