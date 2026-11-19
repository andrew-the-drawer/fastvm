package daemon

import (
	"context"
	"fmt"
	"strings"

	"fastvm/internal/agent"
	"fastvm/internal/manager"
	"fastvm/internal/types"
)

// Shell opens an interactive PTY session in a sandbox. The runtime stays
// "exec active" until the session ends, so auto-sleep does not pause the VM
// underneath the user.
func (d *Daemon) Shell(ctx context.Context, ref string, req agent.ShellRequest) (*agent.ShellSession, error) {
	rt, err := d.runtimeFor(ctx, ref)
	if err != nil {
		return nil, err
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	sb := &rt.sb
	if sb.State.Sleeping() {
		if err := d.wakeLocked(ctx, rt, sb); err != nil {
			return nil, err
		}
	}
	if sb.State != types.StateRunning && sb.State != types.StateIdle {
		return nil, fmt.Errorf("%w: sandbox is %s", manager.ErrConflict, sb.State)
	}
	if _, err := d.ensureAgentLocked(ctx, rt, sb); err != nil {
		return nil, err
	}

	rt.execActive++
	d.touchLocked(rt, sb)
	req.Env = mergeEnvMaps(rt.workloadEnv, req.Env)
	if err := d.persistLocked(ctx, rt, sb); err != nil {
		rt.execActive--
		return nil, err
	}

	sess, err := agent.OpenShell(ctx, sb.VsockUDPath, guestCID(sb.IP), req)
	if err != nil {
		rt.execActive--
		if strings.Contains(err.Error(), `unknown op "shell"`) {
			return nil, fmt.Errorf("sandbox image was built with an older guest agent that has no shell support; "+
				"rebuild its base disk and recreate the sandbox: %w", err)
		}
		return nil, err
	}

	go func() {
		<-sess.Done()
		rt.mu.Lock()
		defer rt.mu.Unlock()
		if rt.closed {
			return
		}
		if rt.execActive > 0 {
			rt.execActive--
		}
		d.touchLocked(rt, sb)
		_ = d.persistLocked(context.Background(), rt, sb)
	}()
	return sess, nil
}

// mergeEnvMaps returns base with override applied. It is used as a fallback for
// base images whose agent predates the env RPC; newer agents merge their own
// copy, and per-request overrides still win there.
func mergeEnvMaps(base, override map[string]string) map[string]string {
	if len(base) == 0 && len(override) == 0 {
		return nil
	}
	out := make(map[string]string, len(base)+len(override))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range override {
		out[k] = v
	}
	return out
}
