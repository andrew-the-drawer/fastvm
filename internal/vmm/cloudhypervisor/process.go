package cloudhypervisor

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// process supervises one VMM or virtiofsd process. Its stdout/stderr are
// redirected to a log file so failures can include a tail of the child's own
// diagnostics.
type process struct {
	cmd     *exec.Cmd
	logPath string
	logFile *os.File
	done    chan struct{}

	errMu sync.Mutex
	err   error
}

// startProcess starts binary with args, redirecting its output to logPath.
// The child gets its own process group so Stop can signal it without touching
// the daemon. configure hooks run just before Start (the VMM jail uses one to
// set credentials, the cgroup and inherited FDs).
func startProcess(binary string, args []string, logPath string, configure ...func(*exec.Cmd)) (*process, error) {
	if dir := filepath.Dir(logPath); dir != "" {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, fmt.Errorf("cloudhypervisor: create log dir: %w", err)
		}
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return nil, fmt.Errorf("cloudhypervisor: open log: %w", err)
	}
	cmd := exec.Command(binary, args...)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	for _, fn := range configure {
		fn(cmd)
	}
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("cloudhypervisor: start %s: %w", binary, err)
	}
	p := &process{cmd: cmd, logPath: logPath, logFile: logFile, done: make(chan struct{})}
	go p.waitLoop()
	return p, nil
}

// waitLoop reaps the process and closes the log file.
func (p *process) waitLoop() {
	err := p.cmd.Wait()
	p.errMu.Lock()
	p.err = err
	p.errMu.Unlock()
	_ = p.logFile.Close()
	close(p.done)
}

func (p *process) pid() int { return p.cmd.Process.Pid }

func (p *process) exited() bool {
	select {
	case <-p.done:
		return true
	default:
		return false
	}
}

func (p *process) waitErr() error {
	p.errMu.Lock()
	defer p.errMu.Unlock()
	return p.err
}

// wait blocks until the process exits or ctx is done.
func (p *process) wait(ctx context.Context) error {
	select {
	case <-p.done:
		if err := p.waitErr(); err != nil {
			return fmt.Errorf("cloudhypervisor: process exited: %w", err)
		}
		return nil
	case <-ctx.Done():
		return fmt.Errorf("cloudhypervisor: wait for process: %w", ctx.Err())
	}
}

// stop gracefully terminates the process: SIGTERM to its process group, then
// SIGKILL if it does not exit within timeout. It is idempotent.
func (p *process) stop(ctx context.Context, timeout time.Duration) error {
	if p.exited() {
		return nil
	}
	if timeout <= 0 {
		timeout = DefaultStopTimeout
	}
	_ = syscall.Kill(-p.pid(), syscall.SIGTERM)
	if waitDone(ctx, p.done, timeout) {
		return nil
	}
	_ = syscall.Kill(-p.pid(), syscall.SIGKILL)
	if waitDone(ctx, p.done, timeout) {
		return nil
	}
	return fmt.Errorf("cloudhypervisor: process %d did not exit after SIGKILL within %s", p.pid(), timeout)
}

func waitDone(ctx context.Context, done <-chan struct{}, timeout time.Duration) bool {
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case <-done:
		return true
	case <-t.C:
		return false
	case <-ctx.Done():
		select {
		case <-done:
			return true
		default:
			return false
		}
	}
}

// logTail returns up to max bytes from the end of path, or "".
func logTail(path string, max int64) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.Size() == 0 {
		return ""
	}
	offset := int64(0)
	if st.Size() > max {
		offset = st.Size() - max
	}
	if _, err := f.Seek(offset, 0); err != nil {
		return ""
	}
	buf := make([]byte, st.Size()-offset)
	n, _ := f.Read(buf)
	return string(buf[:n])
}
