package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"fastvm/internal/manager"
	"fastvm/internal/network"
	"fastvm/internal/types"
	"fastvm/internal/vmm"
	"fastvm/internal/volume"
)

const checkpointVersion = 1

// CheckpointMeta is the portable checkpoint manifest written next to the CH
// snapshot and writable disk image.
type CheckpointMeta struct {
	Version        int       `json:"version"`
	ImageDigest    string    `json:"image_digest"`
	VCPUs          int       `json:"vcpus"`
	MemoryMB       int       `json:"memory_mb"`
	NetworkEnabled bool      `json:"network_enabled"`
	AllowHosts     []string  `json:"allow_hosts,omitempty"`
	VsockCID       uint32    `json:"vsock_cid"`
	CreatedAt      time.Time `json:"created_at"`
}

var hostnameArgRE = regexp.MustCompile(`fastvm\.hostname=[^ ]+`)

// Checkpoint exports a sandbox's memory/CPU snapshot and writable disk into a
// portable directory. Running sandboxes are paused only for the snapshot and
// resumed afterwards.
func (d *Daemon) Checkpoint(ctx context.Context, ref, outDir string) error {
	rt, err := d.runtimeFor(ctx, ref)
	if err != nil {
		return err
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return d.checkpointLocked(ctx, rt, outDir)
}

// checkpointLocked exports a checkpoint; the caller must hold rt.mu.
func (d *Daemon) checkpointLocked(ctx context.Context, rt *runtime, outDir string) error {
	sb := &rt.sb
	if len(sb.Volumes) > 0 {
		return fmt.Errorf("%w: checkpoints with host volumes are not supported yet", manager.ErrConflict)
	}
	if sb.VolumePath == "" {
		return fmt.Errorf("%w: sandbox has no writable disk", manager.ErrConflict)
	}
	abs, err := filepath.Abs(outDir)
	if err != nil {
		return err
	}
	if abs != filepath.Clean(abs) {
		return errors.New("checkpoint: output path must be clean")
	}
	if entries, err := os.ReadDir(abs); err == nil && len(entries) > 0 {
		return fmt.Errorf("checkpoint: output directory %s is not empty", abs)
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return err
	}
	snapDir := filepath.Join(abs, "snapshot")
	if err := os.MkdirAll(snapDir, 0o700); err != nil {
		return err
	}

	resume := false
	switch sb.State {
	case types.StateRunning, types.StateIdle:
		if rt.vm == nil {
			return fmt.Errorf("%w: no VMM to snapshot", manager.ErrConflict)
		}
		if err := rt.vm.Pause(ctx); err != nil {
			return fmt.Errorf("pause for checkpoint: %w", err)
		}
		resume = true
	case types.StatePaused:
		if rt.vm == nil {
			return fmt.Errorf("%w: no VMM to snapshot", manager.ErrConflict)
		}
	case types.StateDormant:
		// Memory snapshot is already on disk.
	default:
		return fmt.Errorf("%w: cannot checkpoint a %s sandbox", manager.ErrConflict, sb.State)
	}
	if resume {
		defer func() {
			resumeCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := rt.vm.Resume(resumeCtx); err != nil {
				d.log.Warn("resume after checkpoint failed", "sandbox", sb.ID, "err", err)
			}
		}()
	}

	if sb.State == types.StateDormant {
		if err := copyDirContents(sb.SnapshotDir, snapDir); err != nil {
			return fmt.Errorf("copy snapshot: %w", err)
		}
	} else {
		if _, err := rt.vm.Snapshot(ctx, snapDir); err != nil {
			return fmt.Errorf("snapshot: %w", err)
		}
	}
	if err := volume.CopyFile(ctx, sb.VolumePath, filepath.Join(abs, "disk.img")); err != nil {
		return fmt.Errorf("copy disk: %w", err)
	}
	meta := CheckpointMeta{
		Version: checkpointVersion, ImageDigest: sb.BaseDisk,
		VCPUs: sb.VCPUs, MemoryMB: sb.MemoryMB,
		NetworkEnabled: sb.NetworkEnabled, AllowHosts: sb.AllowHosts,
		VsockCID: guestCID(sb.IP), CreatedAt: d.now(),
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(abs, "checkpoint.json"), append(data, '\n'), 0o600); err != nil {
		return err
	}
	d.event(ctx, sb.ID, "state", "checkpoint written: "+abs)
	return nil
}

// CheckpointCopy creates a live child from a running sandbox. The parent is
// paused only while the checkpoint is captured, then resumed.
func (d *Daemon) CheckpointCopy(ctx context.Context, from, name string) (types.Sandbox, error) {
	rt, err := d.runtimeFor(ctx, from)
	if err != nil {
		return types.Sandbox{}, err
	}
	parentID := rt.sb.ID
	tmp := filepath.Join(d.cfg.DataDir, "checkpoints", fmt.Sprintf("copy-%s-%d", parentID, time.Now().UnixNano()))
	defer os.RemoveAll(tmp)
	// Checkpoint() takes the runtime lock itself.
	if err := d.Checkpoint(ctx, from, tmp); err != nil {
		return types.Sandbox{}, err
	}
	return d.createFromCheckpoint(ctx, manager.CreateOptions{
		Name: name, FromCheckpoint: tmp, Start: boolPtr(true),
	})
}

func (d *Daemon) createFromCheckpoint(ctx context.Context, opts manager.CreateOptions) (types.Sandbox, error) {
	data, err := os.ReadFile(filepath.Join(opts.FromCheckpoint, "checkpoint.json"))
	if err != nil {
		return types.Sandbox{}, fmt.Errorf("checkpoint: read manifest: %w", err)
	}
	var meta CheckpointMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return types.Sandbox{}, fmt.Errorf("checkpoint: parse manifest: %w", err)
	}
	if meta.Version != checkpointVersion {
		return types.Sandbox{}, fmt.Errorf("checkpoint: unsupported version %d", meta.Version)
	}
	base, err := d.img.Get(ctx, meta.ImageDigest)
	if err != nil {
		return types.Sandbox{}, fmt.Errorf("%w: checkpoint image %q: %v", manager.ErrNotFound, meta.ImageDigest, err)
	}
	id, err := newID()
	if err != nil {
		return types.Sandbox{}, err
	}
	dir := filepath.Join(d.cfg.DataDir, "sandboxes", id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return types.Sandbox{}, err
	}
	sb := types.Sandbox{
		ID: id, Name: opts.Name, BaseDisk: base.Digest,
		VCPUs: meta.VCPUs, MemoryMB: meta.MemoryMB,
		State: types.StateStarting, NetworkEnabled: meta.NetworkEnabled,
		AllowHosts:  meta.AllowHosts,
		VMMAPISock:  filepath.Join(dir, "vmm-api.sock"),
		VsockUDPath: filepath.Join(dir, "vsock.sock"),
		SerialPath:  filepath.Join(dir, "serial.log"),
		SnapshotDir: filepath.Join(dir, "memory"),
		CreatedAt:   d.now(), UpdatedAt: d.now(), LastActivityAt: d.now(),
	}
	if sb.Name == "" {
		sb.Name = "sb-" + id[:8]
	}
	volPath := filepath.Join(d.cfg.DataDir, "volumes", id+".img")
	if err := os.MkdirAll(filepath.Dir(volPath), 0o700); err != nil {
		return types.Sandbox{}, err
	}
	if err := volume.CopyFile(ctx, filepath.Join(opts.FromCheckpoint, "disk.img"), volPath); err != nil {
		return types.Sandbox{}, fmt.Errorf("checkpoint: import disk: %w", err)
	}
	sb.VolumePath = volPath
	if err := copyDirContents(filepath.Join(opts.FromCheckpoint, "snapshot"), sb.SnapshotDir); err != nil {
		return types.Sandbox{}, fmt.Errorf("checkpoint: import snapshot: %w", err)
	}
	if sb.NetworkEnabled {
		port, err := d.net.Create(ctx, network.CreateRequest{SandboxID: sb.ID, Ports: sb.Ports, AllowHosts: sb.AllowHosts})
		if err != nil {
			_ = os.RemoveAll(dir)
			_ = os.Remove(volPath)
			return types.Sandbox{}, fmt.Errorf("checkpoint restore network: %w", err)
		}
		sb.NetnsPath, sb.VethHost, sb.VethIn = port.NetnsPath, port.VethHost, port.VethIn
		sb.TAPName, sb.MAC, sb.IP, sb.Gateway = port.TAPName, port.MAC, port.IP, port.Gateway
	}
	if err := patchCheckpointConfig(sb.SnapshotDir, &sb); err != nil {
		_ = d.net.Delete(context.Background(), id)
		_ = os.RemoveAll(dir)
		_ = os.Remove(volPath)
		return types.Sandbox{}, err
	}
	rt := d.newRuntime(id)
	rt.sb = sb
	if err := d.persistLocked(ctx, rt, &sb); err != nil {
		_ = d.net.Delete(context.Background(), id)
		_ = os.RemoveAll(dir)
		_ = os.Remove(volPath)
		return types.Sandbox{}, err
	}
	d.names.Store(id, sb.Name)
	d.mu.Lock()
	d.runtimes[id] = rt
	d.mu.Unlock()
	if err := d.restoreLocked(ctx, rt, meta.VsockCID); err != nil {
		d.cleanupFailed(context.Background(), &sb)
		return types.Sandbox{}, err
	}
	d.wg.Add(1)
	go d.monitor(rt)
	return rt.sb, nil
}

func (d *Daemon) restoreLocked(ctx context.Context, rt *runtime, cid uint32) error {
	sb := &rt.sb
	_ = d.persistLocked(ctx, rt, sb)
	vm, err := d.vmmD.Restore(ctx, vmm.RestoreConfig{
		SandboxID: sb.ID, Snapshot: vmm.Snapshot{Dir: sb.SnapshotDir},
		TAPName: sb.TAPName, VsockUDPath: sb.VsockUDPath,
		APISocket: sb.VMMAPISock, SerialPath: sb.SerialPath,
		Resume: true,
	})
	if err != nil {
		d.event(ctx, sb.ID, "error", fmt.Sprintf("vmm restore: %v", err))
		sb.State = types.StateFailed
		sb.Error = err.Error()
		return err
	}
	rt.vm = vm
	if cid == 0 {
		cid = guestCID(sb.IP)
	}
	ac, err := d.dial(ctx, sb.VsockUDPath, cid)
	if err != nil {
		_ = vm.Stop(context.Background())
		sb.State = types.StateFailed
		sb.Error = err.Error()
		return err
	}
	rt.ac = ac
	if err := ac.WaitReady(ctx); err != nil {
		_ = vm.Stop(context.Background())
		sb.State = types.StateFailed
		sb.Error = err.Error()
		return err
	}
	if err := ac.SetHostname(ctx, sb.ID[:min(12, len(sb.ID))]); err != nil {
		d.log.Warn("rename restored guest failed", "sandbox", sb.ID, "err", err)
	}
	if sb.NetworkEnabled && sb.IP != "" {
		if err := ac.SetNetwork(ctx, sb.IP+"/30", sb.Gateway); err != nil {
			d.log.Warn("reconfigure restored guest network failed", "sandbox", sb.ID, "err", err)
		}
	}
	now := d.now()
	sb.State = types.StateRunning
	sb.LastActivityAt = now
	sb.WakeCount = 0
	rt.warmupUntil = now.Add(d.cfg.Idle.Warmup.D())
	rt.lastTick = now
	rt.lastCPU = 0
	rt.lastBlock = 0
	rt.lastNetRx, rt.lastNetTx = 0, 0
	_ = d.persistLocked(ctx, rt, sb)
	d.event(ctx, sb.ID, "state", "sandbox restored")
	return nil
}

var checkpointHostnameRE = hostnameArgRE // keep regexp compiled once

func patchCheckpointConfig(snapshotDir string, sb *types.Sandbox) error {
	path := filepath.Join(snapshotDir, "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("checkpoint: read CH config: %w", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("checkpoint: parse CH config: %w", err)
	}
	if disks, ok := cfg["disks"].([]any); ok && len(disks) > 0 {
		if disk, ok := disks[0].(map[string]any); ok {
			disk["path"] = sb.VolumePath
		}
	}
	if serial, ok := cfg["serial"].(map[string]any); ok {
		serial["file"] = sb.SerialPath
	}
	if vsock, ok := cfg["vsock"].(map[string]any); ok {
		vsock["socket"] = sb.VsockUDPath
	}
	if sb.TAPName == "" {
		delete(cfg, "net")
	} else if nets, ok := cfg["net"].([]any); ok && len(nets) > 0 {
		if netcfg, ok := nets[0].(map[string]any); ok {
			netcfg["tap"] = sb.TAPName
			netcfg["mac"] = sb.MAC
		}
	} else {
		return errors.New("checkpoint: snapshot has no NIC but the restored sandbox requested networking")
	}
	if payload, ok := cfg["payload"].(map[string]any); ok {
		if cmdline, ok := payload["cmdline"].(string); ok {
			cmdline = checkpointHostnameRE.ReplaceAllString(cmdline, "fastvm.hostname="+sb.ID)
			payload["cmdline"] = cmdline
		}
	}
	out, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0o600)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func copyDirContents(src, dst string) error {
	if err := os.MkdirAll(dst, 0o700); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			return fmt.Errorf("checkpoint: unexpected directory %s", entry.Name())
		}
		if err := copyFile(filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func boolPtr(v bool) *bool { return &v }
