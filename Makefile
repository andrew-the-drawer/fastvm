GO ?= go
BIN := bin

# Version identity: nearest tag or short commit. -dirty is appended whenever the
# worktree is dirty, even when VERSION is overridden for a release build.
GIT_VERSION := $(shell git describe --tags --always 2>/dev/null | sed 's/^v//')
VERSION ?= $(if $(GIT_VERSION),$(GIT_VERSION),dev)
DIRTY := $(shell [ -n "$$(git status --porcelain 2>/dev/null)" ] && echo -dirty)
BUILD_VERSION := $(VERSION)$(DIRTY)
LDFLAGS := -X fastvm/internal/version.version=$(BUILD_VERSION)

# Install layout (override PREFIX/DESTDIR for packaging or per-user installs).
PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin
DESTDIR ?=
INSTALL ?= install

.PHONY: all build install test test-race vet fmt clean start assets e2e netns-test bpf

all: fmt vet build test

build:
	mkdir -p $(BIN)
	$(GO) build -ldflags "$(LDFLAGS)" -o $(BIN)/fastvmctl ./cmd/fastvm
	$(GO) build -ldflags "$(LDFLAGS)" -o $(BIN)/fastvmd ./cmd/fastvmd
	CGO_ENABLED=0 $(GO) build -o $(BIN)/fastvm-agent ./cmd/fastvm-agent

# Print the version the next build would embed.
version:
	@echo $(BUILD_VERSION)

# Default prefix is /usr/local, so this usually needs sudo. Override with
# PREFIX=$HOME/.local for an unprivileged install, or DESTDIR=... for packaging.
# Binaries must be built first (make build) so install does not compile as root.
install:
	@test -x $(BIN)/fastvmctl -a -x $(BIN)/fastvmd -a -x $(BIN)/fastvm-agent || \
		{ echo "missing binaries: run 'make build' first"; exit 1; }
	$(INSTALL) -d "$(DESTDIR)$(BINDIR)"
	$(INSTALL) -m 0755 $(BIN)/fastvmctl $(BIN)/fastvmd $(BIN)/fastvm-agent "$(DESTDIR)$(BINDIR)/"
	@if [ -L "$(DESTDIR)$(BINDIR)/fastvm" ]; then rm -f "$(DESTDIR)$(BINDIR)/fastvm"; fi

test:
	$(GO) test ./...

test-race:
	$(GO) test -race ./...

vet:
	$(GO) vet ./...

fmt:
	gofmt -w $$($(GO) list -f '{{.Dir}}' ./...)

clean:
	rm -rf $(BIN)

start:
	@test -x $(BIN)/fastvmd || { echo "missing $(BIN)/fastvmd: run 'make build' first"; exit 1; }
	@test "$$(id -u)" -eq 0 || { echo "fastvmd needs root for TAP/bridge/nftables: sudo make start"; exit 1; }
	$(BIN)/fastvmd --config hack/config.yaml

FASTVM_SOCKET ?= /run/fastvm/fastvm.sock
FASTVM ?= $(BIN)/fastvmctl

assets:
	./test/e2e/fetch-assets.sh

# Real-VM end-to-end suite. Requires KVM, Cloud Hypervisor v54+ (or
# cloud-hypervisor-static) and the assets from `make assets`; virtiofsd is
# needed only by the host-volume tests (Cloud Hypervisor + virtiofsd paths can
# be overridden with FASTVM_CLOUD_HYPERVISOR / FASTVM_VIRTIOFSD).
e2e: assets
	FASTVM_E2E=1 $(GO) test -count=1 -timeout 10m ./test/e2e/... ./internal/vmm/cloudhypervisor/...

netns-test:
	FASTVM_NET_TESTS=1 $(GO) test -count=1 -timeout 5m ./internal/network/...

bpf:
	$(MAKE) -C bpf
