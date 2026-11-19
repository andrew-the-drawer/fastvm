package daemon

import (
	"context"
	"fmt"
	"strings"
	"time"

	"fastvm/internal/agent"
)

const (
	userDataMarker  = "/var/lib/fastvm/user-data.done"
	userDataTimeout = 10 * time.Minute
)

// userDataWrapper runs the user script only when the marker is absent. The
// marker lives on the writable root disk, so snapshots carry it and restored
// sandboxes do not rerun user_data.
func userDataWrapper(script string) string {
	return "marker=" + userDataMarker + "\n" +
		"if [ -e \"$marker\" ]; then exit 0; fi\n" +
		"mkdir -p /var/lib/fastvm\n" +
		"(\n" + script + "\n)\n" +
		"rc=$?\n" +
		"if [ \"$rc\" -eq 0 ]; then touch \"$marker\"; fi\n" +
		"exit \"$rc\"\n"
}

// runUserData executes cloud-init-style user_data once, before the sandbox
// workload starts. It uses the existing exec RPC and stdin, so the script is
// not exposed on the kernel command line.
func (d *Daemon) runUserData(ctx context.Context, ac agent.Client, script string, env map[string]string) error {
	resp, err := ac.Exec(ctx, agent.Request{
		ID: newReqID(), Op: agent.OpExec,
		Argv: []string{"/bin/sh", "-s"}, Stdin: userDataWrapper(script), Env: env,
		TimeoutMS: int(userDataTimeout / time.Millisecond),
	})
	if err != nil {
		return err
	}
	if resp.Error != "" || resp.ExitCode != 0 {
		detail := strings.TrimSpace(resp.Stderr)
		if detail == "" {
			detail = strings.TrimSpace(resp.Stdout)
		}
		if len(detail) > 4096 {
			detail = detail[:4096] + "..."
		}
		if detail == "" {
			detail = resp.Error
		}
		return fmt.Errorf("exited %d: %s", resp.ExitCode, detail)
	}
	return nil
}
