package main

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"fastvm/internal/types"
)

// parseVolumes parses repeatable --volume flags. Accepted forms:
//
//	/path                  same path inside the guest
//	/host:/guest           explicit guest path
//	/host[:/guest][:ro]    explicit path with read-only mode
func parseVolumes(raw []string) ([]types.Volume, error) {
	out := make([]types.Volume, 0, len(raw))
	for _, spec := range raw {
		readOnly := false
		if strings.HasSuffix(spec, ":ro") {
			readOnly = true
			spec = strings.TrimSuffix(spec, ":ro")
		} else {
			spec = strings.TrimSuffix(spec, ":rw")
		}
		host, guest, ok := strings.Cut(spec, ":")
		if !ok {
			if !filepath.IsAbs(spec) || filepath.Clean(spec) != spec {
				return nil, fmt.Errorf("volume %q: single-path form must be an absolute clean host path", spec)
			}
			host, guest = spec, spec
		} else if host == "" || guest == "" {
			return nil, fmt.Errorf("volume %q: expected host:guest[:ro]", spec)
		}
		out = append(out, types.Volume{HostPath: host, GuestPath: guest, ReadOnly: readOnly})
	}
	return out, nil
}

var imageRefRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/:@-]*$`)

// ensureImage pulls an OCI image into the daemon's image store when it is not
// already present. No Docker daemon or CLI is involved.
func ensureImage(ref string) error {
	var disks []types.BaseDisk
	if err := getJSON("/v1/images", &disks); err != nil {
		return err
	}
	for _, disk := range disks {
		if disk.Digest == ref || disk.Tag == ref || disk.Name == ref {
			return nil
		}
		for _, tag := range disk.Tags {
			if tag == ref {
				return nil
			}
		}
	}
	if !imageRefRE.MatchString(ref) {
		return fmt.Errorf("image %q is not a valid image reference", ref)
	}
	if _, err := pullImageWithProgress(ref, func() (types.BaseDisk, error) {
		var pulled types.BaseDisk
		if err := do(http.MethodPost, "/v1/images/pull", map[string]any{"ref": ref}, &pulled); err != nil {
			return types.BaseDisk{}, fmt.Errorf("pull image %q: %w", ref, err)
		}
		return pulled, nil
	}); err != nil {
		return err
	}
	return nil
}

func parsePublishes(vals []string) ([]types.PortMapping, error) {
	var out []types.PortMapping
	for _, v := range vals {
		proto := "tcp"
		if i := strings.LastIndexByte(v, '/'); i >= 0 {
			proto = v[i+1:]
			v = v[:i]
		}
		parts := strings.Split(v, ":")
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid --publish %q (want host:guest)", v)
		}
		hp, err1 := strconv.Atoi(parts[0])
		gp, err2 := strconv.Atoi(parts[1])
		if err1 != nil || err2 != nil || hp < 1 || gp < 1 {
			return nil, fmt.Errorf("invalid --publish %q", v)
		}
		if proto != "tcp" && proto != "udp" {
			return nil, fmt.Errorf("invalid protocol %q", proto)
		}
		out = append(out, types.PortMapping{HostPort: hp, GuestPort: gp, Proto: proto})
	}
	return out, nil
}

func parseEnvs(vals []string) (map[string]string, error) {
	if len(vals) == 0 {
		return nil, nil
	}
	env := make(map[string]string, len(vals))
	for _, v := range vals {
		i := strings.IndexByte(v, '=')
		if i <= 0 {
			return nil, fmt.Errorf("invalid --env %q (want K=V)", v)
		}
		env[v[:i]] = v[i+1:]
	}
	return env, nil
}

func short(s string) string {
	if len(s) > 12 {
		return s[:12]
	}
	return s
}

var errMissingImage = errors.New("--image is required")
