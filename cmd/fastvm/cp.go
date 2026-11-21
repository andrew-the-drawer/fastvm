package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

// splitCopyArg splits "vm:path" from a local path. A path that exists locally
// is treated as local even if it contains a colon.
func splitCopyArg(arg string) (ref, path string, remote bool) {
	i := strings.IndexByte(arg, ':')
	if i <= 0 || i == len(arg)-1 {
		return "", arg, false
	}
	if _, err := os.Stat(arg); err == nil {
		return "", arg, false
	}
	return arg[:i], arg[i+1:], true
}

func newCpCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "cp <source> <destination>",
		Short: "Copy files into or out of a sandbox",
		Example: `  fastvmctl cp localfile.txt my-vm:remotefile.txt
  fastvmctl cp my-vm:remotefile.txt localfile.txt`,
		Long: `Copy a regular file between the host and a sandbox.

Use <sandbox>:<path> for the guest side. Relative guest paths resolve against
the sandbox workdir.`,
		Args: exactArgsWithHelp(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runCopy(cmd.Context(), args[0], args[1])
		},
	}
}

func runCopy(ctx context.Context, src, dst string) error {
	srcRef, srcPath, srcRemote := splitCopyArg(src)
	dstRef, dstPath, dstRemote := splitCopyArg(dst)
	if srcRemote == dstRemote {
		return errors.New("cp: exactly one of source and destination must be <sandbox>:<path>")
	}
	if srcRemote {
		return copyFromGuest(ctx, srcRef, srcPath, dstPath)
	}
	return copyToGuest(ctx, srcPath, dstRef, dstPath)
}

func copyToGuest(ctx context.Context, local, ref, remote string) error {
	f, err := os.Open(local)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("cp: %s is not a regular file", local)
	}
	if strings.HasSuffix(remote, "/") {
		remote += filepath.Base(local)
	}
	if remote == "" {
		return errors.New("cp: guest destination path is required")
	}
	q := url.Values{}
	q.Set("path", remote)
	q.Set("mode", strconv.FormatUint(uint64(st.Mode().Perm()), 8))
	resp, err := rawAPIRequest(ctx, http.MethodPut, "/v1/sandboxes/"+url.PathEscape(ref)+"/file?"+q.Encode(), f)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return copyResponseError(resp)
	}
	return nil
}

func copyFromGuest(ctx context.Context, ref, remote, local string) error {
	if remote == "" {
		return errors.New("cp: guest source path is required")
	}
	q := url.Values{}
	q.Set("path", remote)
	resp, err := rawAPIRequest(ctx, http.MethodGet, "/v1/sandboxes/"+url.PathEscape(ref)+"/file?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return copyResponseError(resp)
	}
	if st, err := os.Stat(local); err == nil && st.IsDir() {
		local = filepath.Join(local, filepath.Base(strings.TrimSuffix(remote, "/")))
	}
	dir := filepath.Dir(local)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".fastvm-cp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			_ = tmp.Close()
			_ = os.Remove(tmpName)
		}
	}()
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	mode := os.FileMode(0o644)
	if raw := resp.Header.Get("X-Fastvm-Mode"); raw != "" {
		if v, err := strconv.ParseUint(raw, 8, 32); err == nil {
			mode = os.FileMode(v)
		}
	}
	if err := os.Chmod(tmpName, mode); err != nil {
		return err
	}
	if err := os.Rename(tmpName, local); err != nil {
		return err
	}
	ok = true
	return nil
}

func rawAPIRequest(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	base, hc, err := apiTarget()
	if err != nil {
		return nil, err
	}
	u := base + path
	if base == "" {
		u = "http://fastvm" + path
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	return hc.Do(req)
}

func copyResponseError(resp *http.Response) error {
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	var env struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(data, &env) == nil && env.Error != "" {
		return errors.New(env.Error)
	}
	return fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(data)))
}
