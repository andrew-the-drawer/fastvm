package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"fastvm/internal/agent"
	"fastvm/internal/manager"
	"fastvm/internal/types"
)

// fakeShell is an in-memory shellIO. Output is delivered through an io.Pipe,
// so a test can write PTY output and finish (EOF) or fail (read error).
type fakeShell struct {
	mu        sync.Mutex
	writes    [][]byte
	resizes   [][2]uint16
	exitCode  int
	closedCh  chan struct{}
	closeOnce sync.Once
	pr        *io.PipeReader
	pw        *io.PipeWriter
}

func newFakeShell() *fakeShell {
	pr, pw := io.Pipe()
	return &fakeShell{closedCh: make(chan struct{}), pr: pr, pw: pw}
}

func (f *fakeShell) Read(p []byte) (int, error) { return f.pr.Read(p) }

func (f *fakeShell) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.writes = append(f.writes, append([]byte(nil), p...))
	return len(p), nil
}

func (f *fakeShell) Resize(rows, cols uint16) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resizes = append(f.resizes, [2]uint16{rows, cols})
	return nil
}

func (f *fakeShell) ExitCode() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.exitCode
}

func (f *fakeShell) Close() error {
	f.closeOnce.Do(func() {
		close(f.closedCh)
		_ = f.pr.CloseWithError(io.ErrClosedPipe)
	})
	return nil
}

func (f *fakeShell) output(p []byte) { _, _ = f.pw.Write(p) }

func (f *fakeShell) finish(code int) {
	f.mu.Lock()
	f.exitCode = code
	f.mu.Unlock()
	_ = f.pw.Close()
}

func (f *fakeShell) written() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []byte
	for _, w := range f.writes {
		out = append(out, w...)
	}
	return out
}

func (f *fakeShell) lastResize() ([2]uint16, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.resizes) == 0 {
		return [2]uint16{}, false
	}
	return f.resizes[len(f.resizes)-1], true
}

func (f *fakeShell) closed() bool {
	select {
	case <-f.closedCh:
		return true
	default:
		return false
	}
}

// newShellWSServer serves one WebSocket connection bridged to sh by
// serveShellWS, mirroring what handleShellWS does after a successful open.
func newShellWSServer(t *testing.T, sh shellIO) *httptest.Server {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		conn.SetReadLimit(shellWSReadLimit)
		defer conn.CloseNow()
		serveShellWS(r.Context(), conn, sh)
	}))
	t.Cleanup(ts.Close)
	return ts
}

func dialShellWS(t *testing.T, ts *httptest.Server, path string) (*websocket.Conn, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	u := "ws" + strings.TrimPrefix(ts.URL, "http") + path
	conn, resp, err := websocket.Dial(ctx, u, nil)
	if err != nil {
		t.Fatalf("dial %s: %v (resp=%v)", u, err, resp)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn, ctx
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestServeShellWSBridge(t *testing.T) {
	sh := newFakeShell()
	ts := newShellWSServer(t, sh)
	conn, ctx := dialShellWS(t, ts, "/v1/sandboxes/sb-1/shell/ws")

	// Client binary frames are raw PTY input.
	if err := conn.Write(ctx, websocket.MessageBinary, []byte("echo hi\n")); err != nil {
		t.Fatalf("write input: %v", err)
	}
	waitFor(t, "input to reach the session", func() bool {
		return bytes.Equal(sh.written(), []byte("echo hi\n"))
	})

	// Client text frames are JSON control messages.
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"resize","rows":30,"cols":90}`)); err != nil {
		t.Fatalf("write resize: %v", err)
	}
	waitFor(t, "resize to reach the session", func() bool {
		rz, ok := sh.lastResize()
		return ok && rz == [2]uint16{30, 90}
	})

	// Guest output is delivered as a binary frame.
	sh.output([]byte("hi\n"))
	typ, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if typ != websocket.MessageBinary || string(data) != "hi\n" {
		t.Fatalf("output frame = type %v data %q", typ, data)
	}

	// Guest exit is an exit text frame followed by a normal close.
	sh.finish(7)
	typ, data, err = conn.Read(ctx)
	if err != nil {
		t.Fatalf("read exit: %v", err)
	}
	var exit shellExit
	if err := json.Unmarshal(data, &exit); err != nil {
		t.Fatalf("exit frame %q: %v", data, err)
	}
	if typ != websocket.MessageText || exit.Type != "exit" || exit.Code != 7 {
		t.Fatalf("exit frame = type %v decoded %+v", typ, exit)
	}
	if _, _, err := conn.Read(ctx); websocket.CloseStatus(err) != websocket.StatusNormalClosure {
		t.Fatalf("close status = %v, want %d", websocket.CloseStatus(err), websocket.StatusNormalClosure)
	}
	waitFor(t, "session to close after guest exit", sh.closed)
}

func TestServeShellWSGuestFailureSendsErrorFrame(t *testing.T) {
	sh := newFakeShell()
	ts := newShellWSServer(t, sh)
	conn, ctx := dialShellWS(t, ts, "/v1/sandboxes/sb-1/shell/ws")

	_ = sh.pw.CloseWithError(errors.New("agent: shell: boom"))
	typ, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read error frame: %v", err)
	}
	var se shellError
	if err := json.Unmarshal(data, &se); err != nil {
		t.Fatalf("error frame %q: %v", data, err)
	}
	if typ != websocket.MessageText || se.Type != "error" || se.Message != "agent: shell: boom" {
		t.Fatalf("error frame = type %v decoded %+v", typ, se)
	}
	if _, _, err := conn.Read(ctx); websocket.CloseStatus(err) != websocket.StatusInternalError {
		t.Fatalf("close status = %v, want %d", websocket.CloseStatus(err), websocket.StatusInternalError)
	}
}

func TestServeShellWSClientCloseClosesSession(t *testing.T) {
	sh := newFakeShell()
	ts := newShellWSServer(t, sh)
	conn, ctx := dialShellWS(t, ts, "/v1/sandboxes/sb-1/shell/ws")

	// Ensure the bridge is up before disconnecting.
	if err := conn.Write(ctx, websocket.MessageBinary, []byte("x")); err != nil {
		t.Fatalf("write input: %v", err)
	}
	waitFor(t, "input to reach the session", func() bool { return len(sh.written()) == 1 })

	if err := conn.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatalf("client close: %v", err)
	}
	waitFor(t, "session to close after client disconnect", sh.closed)
}

// shellErrRT is a runtime with the shell capability that always fails to open
// a session, recording the request it received.
type shellErrRT struct {
	*fakeRT
	mu       sync.Mutex
	ref      string
	req      agent.ShellRequest
	shellErr error
}

func (f *shellErrRT) Shell(_ context.Context, ref string, req agent.ShellRequest) (*agent.ShellSession, error) {
	f.mu.Lock()
	f.ref, f.req = ref, req
	f.mu.Unlock()
	return nil, f.shellErr
}

func (f *shellErrRT) recorded() (string, agent.ShellRequest) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.ref, f.req
}

func TestHandleShellWSNotImplemented(t *testing.T) {
	// fakeRT has no Shell method, so it does not implement shellRuntime.
	ts, _, _ := server(t)
	resp, err := http.Get(ts.URL + "/v1/sandboxes/sb-1/shell/ws")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusNotImplemented || !bytes.Contains(body, []byte("shell not supported")) {
		t.Fatalf("status=%d body=%s", resp.StatusCode, body)
	}
}

func TestHandleShellWSOpenErrorAndQuery(t *testing.T) {
	rt := &shellErrRT{
		fakeRT:   &fakeRT{sb: types.Sandbox{ID: "sb-1", Name: "web", State: types.StateRunning}},
		shellErr: manager.ErrNotFound,
	}
	s := New(rt, &fakeImg{disks: []types.BaseDisk{{Name: "img", Digest: "sha256:abc"}}}, nil)
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	// Invalid query values are rejected before the upgrade.
	resp, err := http.Get(ts.URL + "/v1/sandboxes/sb-1/shell/ws?rows=abc")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest || !bytes.Contains(body, []byte("rows must be a uint16")) {
		t.Fatalf("invalid rows status=%d body=%s", resp.StatusCode, body)
	}

	// Shell open failures after the upgrade are reported as an error frame.
	conn, ctx := dialShellWS(t, ts, "/v1/sandboxes/sb-1/shell/ws?rows=40&cols=100&argv=/bin/echo&argv=hi")
	typ, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read error frame: %v", err)
	}
	var se shellError
	if err := json.Unmarshal(data, &se); err != nil {
		t.Fatalf("error frame %q: %v", data, err)
	}
	if typ != websocket.MessageText || se.Type != "error" || !strings.Contains(se.Message, "not found") {
		t.Fatalf("error frame = type %v decoded %+v", typ, se)
	}
	if _, _, err := conn.Read(ctx); websocket.CloseStatus(err) != websocket.StatusInternalError {
		t.Fatalf("close status = %v, want %d", websocket.CloseStatus(err), websocket.StatusInternalError)
	}

	ref, req := rt.recorded()
	if ref != "sb-1" {
		t.Errorf("shell ref = %q, want sb-1", ref)
	}
	if req.Rows != 40 || req.Cols != 100 {
		t.Errorf("rows/cols = %d/%d, want 40/100", req.Rows, req.Cols)
	}
	if !reflect.DeepEqual(req.Argv, []string{"/bin/echo", "hi"}) {
		t.Errorf("argv = %v", req.Argv)
	}
	if req.Env["TERM"] != "xterm-256color" {
		t.Errorf("env = %v, want TERM=xterm-256color", req.Env)
	}

	// Defaults: 24x80 and /bin/sh.
	conn, ctx = dialShellWS(t, ts, "/v1/sandboxes/sb-1/shell/ws")
	if _, _, err := conn.Read(ctx); err != nil {
		t.Fatalf("read error frame: %v", err)
	}
	_, req = rt.recorded()
	if req.Rows != 24 || req.Cols != 80 {
		t.Errorf("default rows/cols = %d/%d, want 24/80", req.Rows, req.Cols)
	}
	if !reflect.DeepEqual(req.Argv, []string{"/bin/sh"}) {
		t.Errorf("default argv = %v, want [/bin/sh]", req.Argv)
	}
}
