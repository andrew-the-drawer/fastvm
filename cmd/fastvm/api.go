package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultSocket = "/run/fastvm/fastvm.sock"

var socketFlag string

func socketPath() string {
	if socketFlag != "" {
		return socketFlag
	}
	if s := os.Getenv("FASTVM_SOCKET"); s != "" {
		return s
	}
	return defaultSocket
}

func client() *http.Client {
	return &http.Client{
		Timeout: 15 * time.Minute, // builds/execs can be long
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, "unix", socketPath())
			},
		},
	}
}

func do(method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, "http://fastvm"+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client().Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach fastvmd at %s: %w", socketPath(), err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		var env struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &env) == nil && env.Error != "" {
			return errors.New(env.Error)
		}
		return fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

func getJSON(path string, out any) error { return do(http.MethodGet, path, nil, out) }
