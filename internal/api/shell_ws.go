package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"

	"fastvm/internal/agent"
)

const (
	// shellWSReadLimit bounds one client->server message. Terminal input is
	// sent in small chunks; the limit protects the daemon from huge frames.
	shellWSReadLimit = 1 << 20 // 1 MiB
	// shellWSWriteTimeout bounds a single server->client WebSocket write.
	shellWSWriteTimeout = 10 * time.Second
)

// shellIO is the subset of *agent.ShellSession the WebSocket bridge needs. It
// keeps serveShellWS testable with a fake in-memory session.
type shellIO interface {
	Read([]byte) (int, error)
	Write([]byte) (int, error)
	Resize(rows, cols uint16) error
	ExitCode() int
	Close() error
}

var _ shellIO = (*agent.ShellSession)(nil)

// shellControl is a client->server text frame.
type shellControl struct {
	Type string `json:"type"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// shellExit is the final server->client text frame after the guest shell exits.
type shellExit struct {
	Type string `json:"type"`
	Code int    `json:"code"`
}

// shellError is the final server->client text frame when the shell fails.
type shellError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// handleShellWS upgrades GET /v1/sandboxes/{ref}/shell/ws to a WebSocket and
// bridges it to an interactive PTY session.
//
// Protocol:
//   - client -> server binary frames are raw PTY input;
//   - client -> server text frames are JSON control, {"type":"resize","cols":N,"rows":N};
//   - server -> client binary frames are raw PTY output;
//   - server -> client text JSON {"type":"exit","code":N} then a normal close, or
//     {"type":"error","message":"..."} then a 1011 close.
//
// Query parameters: rows and cols (uint16, default 24 and 80) and repeatable
// argv (default /bin/sh). The guest shell always gets TERM=xterm-256color.
//
// Runtimes without shell support get a 501 before the upgrade; shell open
// failures after the upgrade (unknown sandbox, not running, ...) are reported
// as an error text frame.
func (s *Server) handleShellWS(w http.ResponseWriter, r *http.Request) {
	sr, ok := s.rt.(shellRuntime)
	if !ok {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "shell not supported by this runtime"})
		return
	}
	req, err := shellRequestFromQuery(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	// The API is a local unix socket guarded by filesystem permissions, so
	// browser origin checks add no security but would reject the console's
	// origin (which is never the socket's host).
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		s.log.Warn("shell ws accept", "err", err)
		return
	}
	conn.SetReadLimit(shellWSReadLimit)
	defer conn.CloseNow()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	sess, err := sr.Shell(ctx, r.PathValue("ref"), req)
	if err != nil {
		// Already upgraded: report the open failure in-band.
		_ = writeShellText(ctx, conn, shellError{Type: "error", Message: err.Error()})
		_ = conn.Close(websocket.StatusInternalError, "shell open failed")
		return
	}
	serveShellWS(ctx, conn, sess)
}

// shellRequestFromQuery builds the shell request from the WebSocket query
// string.
func shellRequestFromQuery(q url.Values) (agent.ShellRequest, error) {
	rows, err := shellQueryUint16(q, "rows", 24)
	if err != nil {
		return agent.ShellRequest{}, err
	}
	cols, err := shellQueryUint16(q, "cols", 80)
	if err != nil {
		return agent.ShellRequest{}, err
	}
	argv := q["argv"]
	if len(argv) == 0 {
		argv = []string{"/bin/sh"}
	}
	return agent.ShellRequest{
		Argv: argv,
		Env:  map[string]string{"TERM": "xterm-256color"},
		Rows: rows,
		Cols: cols,
	}, nil
}

func shellQueryUint16(q url.Values, key string, def uint16) (uint16, error) {
	raw := q.Get(key)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.ParseUint(raw, 10, 16)
	if err != nil {
		return 0, fmt.Errorf("%s must be a uint16", key)
	}
	return uint16(n), nil
}

// serveShellWS bridges one accepted WebSocket connection and one guest PTY
// session until the shell exits, the client disconnects, or either side fails.
// It always closes the session so the guest shell gets SIGHUP when the client
// goes away.
func serveShellWS(ctx context.Context, conn *websocket.Conn, sh shellIO) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer sh.Close()

	// clientGone is closed by the reader goroutine so the output loop can tell
	// a client disconnect (do not write an error frame) from a guest failure.
	clientGone := make(chan struct{})
	var goneOnce sync.Once
	markClientGone := func() { goneOnce.Do(func() { close(clientGone) }) }

	go func() {
		for {
			typ, data, err := conn.Read(ctx)
			if err != nil {
				markClientGone()
				_ = sh.Close()
				return
			}
			switch typ {
			case websocket.MessageBinary:
				if _, err := sh.Write(data); err != nil {
					markClientGone()
					_ = sh.Close()
					return
				}
			case websocket.MessageText:
				var ctl shellControl
				if err := json.Unmarshal(data, &ctl); err != nil || ctl.Type != "resize" {
					continue // ignore malformed or unknown control messages
				}
				_ = sh.Resize(ctl.Rows, ctl.Cols)
			}
		}
	}()

	buf := make([]byte, 32<<10)
	for {
		n, err := sh.Read(buf)
		if n > 0 {
			if werr := writeShellBinary(ctx, conn, buf[:n]); werr != nil {
				return
			}
		}
		if err == nil {
			continue
		}
		select {
		case <-clientGone:
			return // the client already disconnected; no one to report to
		default:
		}
		if errors.Is(err, io.EOF) {
			_ = writeShellText(ctx, conn, shellExit{Type: "exit", Code: sh.ExitCode()})
			_ = conn.Close(websocket.StatusNormalClosure, "")
			return
		}
		_ = writeShellText(ctx, conn, shellError{Type: "error", Message: err.Error()})
		_ = conn.Close(websocket.StatusInternalError, "shell failed")
		return
	}
}

func writeShellBinary(ctx context.Context, conn *websocket.Conn, p []byte) error {
	ctx, cancel := context.WithTimeout(ctx, shellWSWriteTimeout)
	defer cancel()
	return conn.Write(ctx, websocket.MessageBinary, p)
}

func writeShellText(ctx context.Context, conn *websocket.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, shellWSWriteTimeout)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, data)
}
