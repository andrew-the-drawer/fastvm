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

.PHONY: all build build-cli install test test-race vet fmt clean start assets e2e netns-test bpf certs \
	mac-build mac-up mac-start mac-stop mac-delete mac-shell mac-env mac-e2e

all: fmt vet build test

build:
	mkdir -p $(BIN)
	$(GO) build -ldflags "$(LDFLAGS)" -o $(BIN)/fastvmctl ./cmd/fastvm
	$(GO) build -ldflags "$(LDFLAGS)" -o $(BIN)/fastvmd ./cmd/fastvmd
	CGO_ENABLED=0 $(GO) build -o $(BIN)/fastvm-agent ./cmd/fastvm-agent

# Just the CLI. Unlike `build`, this also works on macOS, where fastvmctl
# drives a daemon in a Lima VM (docs/MACOS.md).
build-cli:
	mkdir -p $(BIN)
	$(GO) build -ldflags "$(LDFLAGS)" -o $(BIN)/fastvmctl ./cmd/fastvm

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

# Local mTLS certificates for the optional TCP API and fastvmctl.
# Output:
#   $(CERTS_DIR)/server/{ca.pem,cert.pem,key.pem}  fastvmd api.cert_path
#   $(CERTS_DIR)/client/{ca.pem,cert.pem,key.pem}  FASTVM_CERT_PATH
CERTS_DIR ?= /tmp/fastvm/certs

certs:
	@command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }
	@mkdir -p "$(CERTS_DIR)/server" "$(CERTS_DIR)/client"
	@chmod 700 "$(CERTS_DIR)" "$(CERTS_DIR)/server" "$(CERTS_DIR)/client"
	@rm -f "$(CERTS_DIR)"/ca.key "$(CERTS_DIR)"/ca.pem "$(CERTS_DIR)"/ca.srl \
		"$(CERTS_DIR)"/server/* "$(CERTS_DIR)"/client/*
	@openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
		-keyout "$(CERTS_DIR)/ca.key" -out "$(CERTS_DIR)/ca.pem" \
		-subj "/CN=fastvm-ca"
	@cp "$(CERTS_DIR)/ca.pem" "$(CERTS_DIR)/server/ca.pem"
	@cp "$(CERTS_DIR)/ca.pem" "$(CERTS_DIR)/client/ca.pem"
	@openssl req -newkey rsa:2048 -nodes \
		-keyout "$(CERTS_DIR)/server/key.pem" -out "$(CERTS_DIR)/server/server.csr" \
		-subj "/CN=fastvm-api"
	@printf '%s\n' \
		'basicConstraints=CA:FALSE' \
		'keyUsage=digitalSignature,keyEncipherment' \
		'extendedKeyUsage=serverAuth' \
		'subjectAltName=DNS:localhost,IP:127.0.0.1' \
		> "$(CERTS_DIR)/server/server.ext"
	@openssl x509 -req -in "$(CERTS_DIR)/server/server.csr" \
		-CA "$(CERTS_DIR)/ca.pem" -CAkey "$(CERTS_DIR)/ca.key" -CAcreateserial \
		-out "$(CERTS_DIR)/server/cert.pem" -days 825 -sha256 \
		-extfile "$(CERTS_DIR)/server/server.ext"
	@openssl req -newkey rsa:2048 -nodes \
		-keyout "$(CERTS_DIR)/client/key.pem" -out "$(CERTS_DIR)/client/client.csr" \
		-subj "/CN=fastvm-client"
	@printf '%s\n' \
		'basicConstraints=CA:FALSE' \
		'keyUsage=digitalSignature' \
		'extendedKeyUsage=clientAuth' \
		> "$(CERTS_DIR)/client/client.ext"
	@openssl x509 -req -in "$(CERTS_DIR)/client/client.csr" \
		-CA "$(CERTS_DIR)/ca.pem" -CAkey "$(CERTS_DIR)/ca.key" -CAcreateserial \
		-out "$(CERTS_DIR)/client/cert.pem" -days 825 -sha256 \
		-extfile "$(CERTS_DIR)/client/client.ext"
	@rm -f "$(CERTS_DIR)/server/server.csr" "$(CERTS_DIR)/server/server.ext" \
		"$(CERTS_DIR)/client/client.csr" "$(CERTS_DIR)/client/client.ext"
	@chmod 600 "$(CERTS_DIR)/ca.key" "$(CERTS_DIR)/server/key.pem" "$(CERTS_DIR)/client/key.pem"
	@chmod 644 "$(CERTS_DIR)/ca.pem" "$(CERTS_DIR)/server/ca.pem" "$(CERTS_DIR)/server/cert.pem" \
		"$(CERTS_DIR)/client/ca.pem" "$(CERTS_DIR)/client/cert.pem"
	@echo "server certs: $(CERTS_DIR)/server"
	@echo "client certs: $(CERTS_DIR)/client"


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

# macOS: fastvmd runs inside a Lima VM with nested virtualization (Apple
# Silicon M3+, macOS 15+); the native fastvmctl talks to it over mTLS. See
# docs/MACOS.md. mac-build is linux/arm64 daemon+agent plus the native CLI.
mac-build:
	GOOS=linux GOARCH=arm64 $(MAKE) build BIN=$(BIN)/linux-arm64
	$(MAKE) build-cli

mac-up mac-start mac-stop mac-delete mac-shell mac-env mac-e2e:
	@hack/lima/fastvm-lima.sh $(@:mac-%=%)
