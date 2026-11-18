// Package manager defines the runtime operations exposed to the CLI and HTTP
// API (docs/DESIGN.md §6.2). The daemon implements it.
package manager

import (
	"context"

	"fastvm/internal/agent"
	"fastvm/internal/types"
)

// CreateOptions describes a new sandbox.
type CreateOptions struct {
	Name        string
	Image       string // base disk tag or digest
	VCPUs       int
	MemoryMB    int
	Ports       []types.PortMapping
	Volumes     []types.Volume
	Cmd         []string          // workload started after agent Ready (detached)
	Env         map[string]string // workload environment
	NoAutoSleep bool
	// Start boots the VM immediately (default true when nil). A false value
	// creates the sandbox in StateCreated so it can be started later.
	Start *bool
	// NetworkEnabled defaults to true when nil. False boots the guest with no
	// NIC/TAP at all.
	NetworkEnabled *bool
	AllowHosts     []string
	// FromCheckpoint restores a sandbox from a checkpoint directory. When set,
	// Image is ignored and the checkpoint manifest supplies the base image.
	FromCheckpoint string
}

// Runtime is the daemon-facing sandbox API.
type Runtime interface {
	Create(ctx context.Context, opts CreateOptions) (types.Sandbox, error)
	Start(ctx context.Context, ref string) error
	Checkpoint(ctx context.Context, ref, outDir string) error
	CheckpointCopy(ctx context.Context, from, name string) (types.Sandbox, error)
	Get(ctx context.Context, ref string) (types.Sandbox, error)
	Stats(ctx context.Context, ref string) (types.SandboxStats, error)
	List(ctx context.Context) ([]types.Sandbox, error)
	Exec(ctx context.Context, ref string, argv []string, env map[string]string) (agent.Response, error)
	Sleep(ctx context.Context, ref string, deep bool) error
	Wake(ctx context.Context, ref string) error
	Delete(ctx context.Context, ref string) error
	Events(ctx context.Context, limit int) ([]types.Event, error)
	Close() error
}

// Images is the image-management API.
type Images interface {
	BuildImage(ctx context.Context, spec BuildOptions) (types.BaseDisk, error)
	ListImages(ctx context.Context) ([]types.BaseDisk, error)
	IngestRootfs(ctx context.Context, rootfsDir, tag string) (types.BaseDisk, error)
	RemoveImage(ctx context.Context, ref string, force bool) (types.BaseDisk, error)
}

// BuildOptions is a CLI-facing Dockerfile build request.
type BuildOptions struct {
	Dockerfile string
	ContextDir string
	Tag        string
	SizeGB     int
}
