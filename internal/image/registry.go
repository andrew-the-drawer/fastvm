package image

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/remote"

	"fastvm/internal/types"
)

// Pull downloads ref from its OCI registry, flattens the image layers into a
// temporary rootfs, injects the guest agent/init, and writes a base disk.
func (b *FSBuilder) Pull(ctx context.Context, spec PullSpec) (types.BaseDisk, error) {
	if err := ctx.Err(); err != nil {
		return types.BaseDisk{}, err
	}
	ref := spec.Ref
	if ref == "" {
		return types.BaseDisk{}, errors.New("image: reference is required")
	}
	rootfs, cleanup, err := b.registryRootfs(ctx, ref)
	if err != nil {
		return types.BaseDisk{}, err
	}
	defer cleanup()
	return b.makeBaseDisk(ctx, baseDiskRequest{
		srcRootfs: rootfs,
		tag:       ref,
		sizeGB:    spec.SizeGB,
		agentPath: spec.AgentPath,
		initPath:  spec.InitPath,
		source:    "registry",
	})
}

// registryRootfs pulls ref and extracts its flattened rootfs. No Docker daemon
// or CLI is involved; registry credentials come from the Docker config
// keychain.
func (b *FSBuilder) registryRootfs(ctx context.Context, ref string) (string, func(), error) {
	nameOpts := []name.Option{}
	if b.insecureRegistry {
		nameOpts = append(nameOpts, name.Insecure)
	}
	parsed, err := name.ParseReference(ref, nameOpts...)
	if err != nil {
		return "", nil, fmt.Errorf("image: parse reference %q: %w", ref, err)
	}
	img, err := remote.Image(parsed,
		remote.WithContext(ctx),
		remote.WithAuthFromKeychain(authn.DefaultKeychain),
		remote.WithPlatform(v1.Platform{OS: "linux", Architecture: runtime.GOARCH}),
	)
	if err != nil {
		return "", nil, fmt.Errorf("image: pull %q: %w", ref, err)
	}
	workDir, err := os.MkdirTemp(b.workDir, ".fastvm-pull-*")
	if err != nil {
		return "", nil, fmt.Errorf("image: create pull workspace: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(workDir) }
	rootfs := workDir + "/rootfs"
	if err := os.MkdirAll(rootfs, 0o700); err != nil {
		cleanup()
		return "", nil, fmt.Errorf("image: create rootfs dir: %w", err)
	}
	rc := mutate.Extract(img)
	extractErr := extractTar(rootfs, rc)
	closeErr := rc.Close()
	if extractErr != nil {
		cleanup()
		return "", nil, fmt.Errorf("image: unpack %q: %w", ref, extractErr)
	}
	if closeErr != nil {
		cleanup()
		return "", nil, fmt.Errorf("image: close %q: %w", ref, closeErr)
	}
	return rootfs, cleanup, nil
}
