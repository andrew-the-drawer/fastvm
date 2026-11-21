package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultSocket = "/run/fastvm/fastvm.sock"

var socketFlag string

// socketPath returns the unix socket path, honoring --socket and
// FASTVM_SOCKET.
func socketPath() string {
	if socketFlag != "" {
		return socketFlag
	}
	if s := os.Getenv("FASTVM_SOCKET"); s != "" {
		return s
	}
	return defaultSocket
}

// apiBaseURL returns the configured TCP REST endpoint. An explicit --socket
// wins for local use; otherwise FASTVM_HOST selects HTTPS.
func apiBaseURL() string {
	if socketFlag != "" {
		return ""
	}
	host := strings.TrimRight(strings.TrimSpace(os.Getenv("FASTVM_HOST")), "/")
	if host == "" {
		return ""
	}
	if !strings.Contains(host, "://") {
		host = "https://" + host
	}
	return host
}

// tlsClientConfig loads the mTLS client identity and CA from FASTVM_CERT_PATH.
// The directory must contain ca.pem, cert.pem, and key.pem.
func tlsClientConfig() (*tls.Config, error) {
	dir := strings.TrimSpace(os.Getenv("FASTVM_CERT_PATH"))
	if dir == "" {
		return nil, errors.New("FASTVM_HOST requires FASTVM_CERT_PATH containing ca.pem, cert.pem, and key.pem")
	}
	certFile := filepath.Join(dir, "cert.pem")
	keyFile := filepath.Join(dir, "key.pem")
	caFile := filepath.Join(dir, "ca.pem")
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load %s / %s: %w", certFile, keyFile, err)
	}
	caPEM, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", caFile, err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("CA file %s contains no certificates", caFile)
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		RootCAs:      pool,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

// apiTarget validates the selected transport and returns its client.
func apiTarget() (base string, client *http.Client, err error) {
	base = apiBaseURL()
	if base == "" {
		return "", &http.Client{
			Timeout: 15 * time.Minute,
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					var d net.Dialer
					return d.DialContext(ctx, "unix", socketPath())
				},
			},
		}, nil
	}
	u, err := url.Parse(base)
	if err != nil {
		return "", nil, fmt.Errorf("parse FASTVM_HOST: %w", err)
	}
	if u.Scheme != "https" || u.Host == "" {
		return "", nil, fmt.Errorf("FASTVM_HOST must be https://host:port (or host:port), got %q", base)
	}
	tlsCfg, err := tlsClientConfig()
	if err != nil {
		return "", nil, err
	}
	tlsCfg.ServerName = u.Hostname()
	return base, &http.Client{
		Timeout:   15 * time.Minute,
		Transport: &http.Transport{TLSClientConfig: tlsCfg},
	}, nil
}

func do(method, path string, body any, out any) error {
	base, hc, err := apiTarget()
	if err != nil {
		return err
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	url := base + path
	if base == "" {
		url = "http://fastvm" + path
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := hc.Do(req)
	if err != nil {
		if base == "" {
			return fmt.Errorf("cannot reach fastvmd at %s: %w", socketPath(), err)
		}
		return fmt.Errorf("cannot reach fastvmd at %s: %w", base, err)
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

// dialAPI opens a raw connection for the shell-upgrade endpoint, using TLS when
// FASTVM_HOST is configured.
func dialAPI(ctx context.Context) (net.Conn, error) {
	base := apiBaseURL()
	if base == "" {
		var d net.Dialer
		return d.DialContext(ctx, "unix", socketPath())
	}
	u, err := url.Parse(base)
	if err != nil {
		return nil, err
	}
	tlsCfg, err := tlsClientConfig()
	if err != nil {
		return nil, err
	}
	d := &net.Dialer{Timeout: 15 * time.Second}
	conn, err := tls.DialWithDialer(d, "tcp", u.Host, tlsCfg)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func apiHost() string {
	if base := apiBaseURL(); base != "" {
		if u, err := url.Parse(base); err == nil {
			return u.Host
		}
	}
	return "fastvm"
}
