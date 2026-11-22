#!/usr/bin/env bash
# Fetch the pinned Cloud Hypervisor test kernel and an Alpine rootfs for
# demos/e2e tests. Cached under test/e2e/assets (gitignored). Safe to re-run:
# an existing file is re-verified against its SHA-256 and re-downloaded when it
# does not match (e.g. a stale Firecracker quickstart kernel from before the
# Cloud Hypervisor migration).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)/assets"
mkdir -p "$DIR"

# Guest architecture: the host's by default. FASTVM_ARCH=arm64 fetches the
# aarch64 assets, e.g. for fastvm inside a Lima VM on Apple Silicon
# (docs/MACOS.md). Output names stay the same on every arch so configs and the
# e2e suite need no changes; switching arch re-downloads both assets.
ARCH="${FASTVM_ARCH:-$(uname -m)}"
case "$ARCH" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  *) echo "error: unsupported architecture: $ARCH (want x86_64 or arm64)" >&2; exit 1 ;;
esac

# Cloud Hypervisor's own prebuilt test kernel. The Firecracker quickstart kernel
# cannot be used: it only has virtio-mmio devices, while Cloud Hypervisor uses a
# PCI transport and also needs virtio-fs/FUSE for host-directory volumes. On
# arm64 Cloud Hypervisor boots the uncompressed Image format.
KERNEL_RELEASE="ch-release-v7.2.8-20261009"
if [[ "$ARCH" == x86_64 ]]; then
  KERNEL_ASSET="vmlinux-x86_64"
  KERNEL_SHA256="edfeb8a8a6c04ff2979e9f1c700feaa29b8f564f952261834ef0b7d2e673a853"
else
  KERNEL_ASSET="Image-arm64"
  KERNEL_SHA256="8f8f3d5a983809f87a4e1e9a13053a3361fda47ef04e09c771a41c5e037cb6c2"
fi
KERNEL_URL="https://github.com/cloud-hypervisor/linux/releases/download/$KERNEL_RELEASE/$KERNEL_ASSET"
KERNEL="$DIR/vmlinux.bin"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

if [[ ! -f "$KERNEL" ]] || [[ "$(sha256_of "$KERNEL")" != "$KERNEL_SHA256" ]]; then
  echo "downloading Cloud Hypervisor test kernel ($KERNEL_RELEASE, $KERNEL_ASSET)..."
  curl -fsSL --retry 3 -o "$KERNEL.tmp" "$KERNEL_URL"
  got="$(sha256_of "$KERNEL.tmp")"
  if [[ "$got" != "$KERNEL_SHA256" ]]; then
    rm -f "$KERNEL.tmp"
    echo "error: kernel SHA-256 mismatch: got $got" >&2
    echo "       expected $KERNEL_SHA256" >&2
    exit 1
  fi
  mv "$KERNEL.tmp" "$KERNEL"
fi

# Alpine records its arch in /etc/apk/arch; replace a rootfs for another arch.
if [[ -d "$DIR/rootfs" && "$(cat "$DIR/rootfs/etc/apk/arch" 2>/dev/null || true)" != "$ARCH" ]]; then
  echo "replacing rootfs for another architecture..."
  rm -rf "$DIR/rootfs"
fi
if [[ ! -d "$DIR/rootfs" ]]; then
  echo "downloading Alpine minirootfs ($ARCH)..."
  curl -fsSL --retry 3 -o "$DIR/alpine.tgz.tmp" \
    "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/$ARCH/alpine-minirootfs-3.20.3-$ARCH.tar.gz"
  mkdir -p "$DIR/rootfs"
  tar -xzf "$DIR/alpine.tgz.tmp" -C "$DIR/rootfs"
  rm -f "$DIR/alpine.tgz.tmp"
fi

echo "e2e assets ready ($ARCH):"
echo "  FASTVM_KERNEL=$KERNEL"
echo "  FASTVM_ROOTFS=$DIR/rootfs"

# Report the host tooling the daemon/e2e suites need. This script never installs
# anything: Cloud Hypervisor (v54+) and virtiofsd (>= 1.10, or >= 1.13 for
# read-only volumes; only needed for host-directory volumes) are system packages.
CH_BIN="$(command -v cloud-hypervisor || command -v cloud-hypervisor-static || true)"
VIRTIOFSD_BIN="$(command -v virtiofsd || true)"
if [[ -z "$VIRTIOFSD_BIN" && -x /usr/lib/virtiofsd ]]; then
  VIRTIOFSD_BIN=/usr/lib/virtiofsd
fi

echo "host tools (not installed by this script):"
if [[ -n "$CH_BIN" ]]; then
  echo "  cloud-hypervisor: $CH_BIN ($("$CH_BIN" --version 2>/dev/null | head -n 1))"
else
  echo "  cloud-hypervisor: MISSING — install Cloud Hypervisor v54+ (or set vmm.binary / FASTVM_CLOUD_HYPERVISOR to an absolute path)"
fi
if [[ -n "$VIRTIOFSD_BIN" ]]; then
  echo "  virtiofsd: $VIRTIOFSD_BIN"
else
  echo "  virtiofsd: MISSING — install virtiofsd >= 1.10, >= 1.13 for read-only volumes (distro package usually ships /usr/lib/virtiofsd); only needed for host-directory volumes"
fi
echo "  override hints: FASTVM_CLOUD_HYPERVISOR / FASTVM_VIRTIOFSD (e2e) or vmm.binary / vmm.virtiofsd (daemon config)"
