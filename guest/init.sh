#!/bin/sh
# fastvm guest init (injected at /init).
#
# The kernel boots with "console=ttyS0 root=/dev/vda rw init=/init"; this script
# mounts the pseudo filesystems the agent and userland need, then execs the
# static agent as PID 1. The agent serves vsock port 1024 and starts the
# optional workload from /etc/fastvm/workload.json.
#
# Keep this POSIX sh (busybox) only; no bashisms.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true

mkdir -p /dev /dev/pts /dev/shm /tmp /run /var/log/fastvm
mount -t devtmpfs devtmpfs /dev 2>/dev/null || mount -t tmpfs tmpfs /dev 2>/dev/null || true
mount -t devpts devpts /dev/pts 2>/dev/null || true
mount -t tmpfs tmpfs /dev/shm 2>/dev/null || true

# The virtio-vsock misc device may be probed asynchronously after this init
# starts, and devtmpfs only creates nodes for devices present when it mounts.
# Populate /dev from sysfs (mdev) and wait for /dev/vsock; as a last resort
# create the node from /sys/class/misc/vsock/dev. Without it the agent cannot
# listen on vsock and the sandbox never becomes Ready.
mdev -s 2>/dev/null || true
i=0
while [ ! -e /dev/vsock ] && [ "$i" -lt 100 ]; do
	sleep 0.1 2>/dev/null || sleep 1
	mdev -s 2>/dev/null || true
	i=$((i + 1))
done
if [ ! -e /dev/vsock ]; then
	dev=$(cat /sys/class/misc/vsock/dev 2>/dev/null)
	if [ -n "$dev" ]; then
		major=${dev%:*}
		minor=${dev#*:}
		mknod /dev/vsock c "$major" "$minor" 2>/dev/null || true
	fi
fi

# Mount host directories shared over virtio-fs (Cloud Hypervisor --fs).
# The daemon appends one entry per volume to the kernel cmdline:
#   fastvm.volume.<n>=<tag>:<guest_path>:<ro|rw>
# Keep this POSIX sh/busybox only. Paths are validated by the daemon.
i=0
while :; do
	spec=""
	for tok in $(cat /proc/cmdline); do
		case "$tok" in
		"fastvm.volume.$i="*)
			spec=${tok#fastvm.volume.$i=}
			;;
		esac
	done
	[ -n "$spec" ] || break
	tag=${spec%%:*}
	rest=${spec#*:}
	mnt=${rest%%:*}
	mode=${rest##*:}
	mkdir -p "$mnt" 2>/dev/null || true
	if [ "$mode" = "ro" ]; then
		mount -t virtiofs -o ro "$tag" "$mnt" 2>/dev/null ||
			echo "fastvm: warning: could not mount $tag (ro) at $mnt"
	else
		mount -t virtiofs "$tag" "$mnt" 2>/dev/null ||
			echo "fastvm: warning: could not mount $tag at $mnt"
	fi
	i=$((i + 1))
done

# Best-effort identity; not required for correctness.
hostname fastvm 2>/dev/null || true
echo "FASTVM_BOOT_OK"

exec /usr/local/bin/fastvm-agent --workload-config /etc/fastvm/workload.json
