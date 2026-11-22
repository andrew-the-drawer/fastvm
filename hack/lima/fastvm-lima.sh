#!/usr/bin/env bash
# Run fastvm on macOS inside a Lima VM with nested virtualization (docs/MACOS.md).
#
#   hack/lima/fastvm-lima.sh up       build, fetch assets, create/start the VM, start fastvmd
#   hack/lima/fastvm-lima.sh start    start the VM if needed, re-provision, restart fastvmd
#   hack/lima/fastvm-lima.sh stop     stop the VM (sandboxes stop with it)
#   hack/lima/fastvm-lima.sh delete   delete the VM and all sandboxes/images inside it
#   hack/lima/fastvm-lima.sh env      print exports for the native fastvmctl
#   hack/lima/fastvm-lima.sh status   VM and daemon status
#   hack/lima/fastvm-lima.sh logs     follow the daemon log
#   hack/lima/fastvm-lima.sh shell    open a shell in the VM
#   hack/lima/fastvm-lima.sh forward PORT...
#                                     tunnel published sandbox ports to the Mac's
#                                     127.0.0.1 (foreground; Ctrl-C to stop)
#   hack/lima/fastvm-lima.sh e2e      run `make e2e` (real-VM suite) as root in the VM;
#                                     installs the pinned Go toolchain there first
#
# Environment overrides:
#   FASTVM_LIMA_INSTANCE  Lima instance name (default fastvm)
#   FASTVM_LIMA_STATE     host state dir for API certs (default ~/.fastvm/lima;
#                         must be under $HOME so the VM can read it)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
INSTANCE="${FASTVM_LIMA_INSTANCE:-fastvm}"
STATE="${FASTVM_LIMA_STATE:-$HOME/.fastvm/lima}"
TEMPLATE="$REPO/hack/lima/fastvm.yaml"
API_ADDR="127.0.0.1:8443"
# Go toolchain for `e2e` only (the suite builds binaries at runtime).
GO_VERSION="go1.27.4"
GO_SHA256="3392582988a273a87ab5043ee1b2c9c17a2c3c00580bf9326c47a2e0aaaeac92"
CMD="${1:-}"

die() { echo "fastvm-lima: error: $*" >&2; exit 1; }
log() { echo "fastvm-lima: $*"; }
usage() { sed -n '2,/^set -euo pipefail$/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

under_home() { [[ "$1" == "$HOME" || "$1" == "$HOME/"* ]]; }

check_host() {
	[[ "$(uname -s)" == Darwin ]] || die "this helper is for macOS; on Linux run fastvmd directly"
	[[ "$(uname -m)" == arm64 ]] || die "Apple Silicon is required (nested virtualization is arm64-only)"
	local major
	major="$(sw_vers -productVersion | cut -d. -f1)"
	((major >= 15)) || die "macOS 15 or newer is required for nested virtualization (found $(sw_vers -productVersion))"
	command -v limactl >/dev/null || die "limactl not found: brew install lima"
	under_home "$STATE" || die "FASTVM_LIMA_STATE ($STATE) must be under \$HOME so the VM can mount it"
}

instance_status() {
	limactl list --format '{{.Status}}' "$INSTANCE" 2>/dev/null || true
}

build() {
	log "building linux/arm64 daemon + agent and the native fastvmctl"
	make -C "$REPO" mac-build >/dev/null
	log "fetching arm64 guest kernel"
	FASTVM_ARCH=arm64 "$REPO/test/e2e/fetch-assets.sh" | sed -n '1,/^host tools/p' | sed '$d'
	if [[ ! -f "$STATE/certs/client/cert.pem" ]]; then
		log "generating mTLS certificates in $STATE/certs"
		mkdir -p "$STATE"
		make -C "$REPO" certs CERTS_DIR="$STATE/certs" >/dev/null
	fi
}

ensure_vm() {
	case "$(instance_status)" in
	Running) ;;
	Stopped)
		log "starting Lima VM $INSTANCE"
		limactl start --tty=false "$INSTANCE"
		;;
	"")
		log "creating Lima VM $INSTANCE (first boot downloads the Debian image)"
		local set=()
		if ! under_home "$REPO"; then
			set=(--set ".mounts += [{\"location\": \"$REPO\", \"writable\": false}]")
		fi
		mkdir -p /tmp/lima
		limactl create --tty=false --name="$INSTANCE" "${set[@]}" "$TEMPLATE"
		limactl start --tty=false "$INSTANCE"
		;;
	*) die "Lima VM $INSTANCE is in state $(instance_status); try: limactl stop $INSTANCE" ;;
	esac
}

provision() {
	limactl shell --workdir / "$INSTANCE" sudo \
		FASTVM_REPO="$REPO" FASTVM_STATE="$STATE" FASTVM_HOME="$HOME" \
		bash "$REPO/hack/lima/provision.sh"
}

run_e2e() {
	# The checkout is mounted read-only, so the suite runs on a copy in the VM.
	limactl shell --workdir / "$INSTANCE" sudo bash -euo pipefail -c '
		if [[ "$(/usr/local/go/bin/go version 2>/dev/null | cut -d" " -f3)" != '"$GO_VERSION"' ]]; then
			echo "fastvm-lima: installing '"$GO_VERSION"' in the VM"
			curl -fsSL --retry 3 -o /tmp/go.tgz https://go.dev/dl/'"$GO_VERSION"'.linux-arm64.tar.gz
			echo "'"$GO_SHA256"'  /tmp/go.tgz" | sha256sum -c --quiet
			rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz && rm -f /tmp/go.tgz
		fi
		command -v make >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq make >/dev/null; }
		export PATH=/usr/local/go/bin:/usr/local/bin:$PATH CGO_ENABLED=0
		export FASTVM_CLOUD_HYPERVISOR=/usr/local/bin/cloud-hypervisor
		export FASTVM_VIRTIOFSD=/usr/libexec/virtiofsd
		# The suite writes scratch rootfs dirs into the tree; the mount is read-only.
		rm -rf /var/tmp/fastvm-e2e && mkdir -p /var/tmp/fastvm-e2e
		tar -C "'"$REPO"'" --exclude=./.git --exclude=./console --exclude=./bin -cf - . | tar -C /var/tmp/fastvm-e2e -xf -
		cd /var/tmp/fastvm-e2e && make e2e
	'
}

print_env() {
	echo "export FASTVM_HOST=$API_ADDR"
	echo "export FASTVM_CERT_PATH=$STATE/certs/client"
}

case "$CMD" in
up)
	check_host
	build
	ensure_vm
	provision
	echo
	log "ready. Point the native CLI at the VM:"
	echo "  eval \"\$($0 env)\""
	echo "  $REPO/bin/fastvmctl run --image alpine -- uname -a"
	;;
start)
	check_host
	ensure_vm
	provision
	;;
stop)
	limactl stop "$INSTANCE"
	;;
delete)
	limactl delete --force "$INSTANCE"
	;;
env)
	print_env
	;;
e2e)
	run_e2e
	;;
forward)
	# Published ports are nftables DNAT in the VM, with no listening socket, so
	# Lima's automatic forwarder never sees them; tunnel them over Lima's SSH.
	shift
	(($#)) || die "usage: $0 forward PORT [PORT...]"
	args=()
	for p in "$@"; do
		[[ "$p" =~ ^[0-9]+$ ]] || die "invalid port: $p"
		args+=(-L "127.0.0.1:$p:127.0.0.1:$p")
		log "forwarding 127.0.0.1:$p -> sandbox port published on $p in the VM"
	done
	exec ssh -F "$HOME/.lima/$INSTANCE/ssh.config" -S none -N -o ExitOnForwardFailure=yes "${args[@]}" "lima-$INSTANCE"
	;;
status)
	limactl list "$INSTANCE"
	[[ "$(instance_status)" == Running ]] &&
		limactl shell --workdir / "$INSTANCE" systemctl --no-pager status fastvmd | head -n 5
	;;
logs)
	limactl shell --workdir / "$INSTANCE" sudo journalctl -u fastvmd -f
	;;
shell)
	shift
	limactl shell --workdir / "$INSTANCE" "$@"
	;;
-h | --help | help | "")
	usage
	;;
*)
	usage >&2
	exit 2
	;;
esac
