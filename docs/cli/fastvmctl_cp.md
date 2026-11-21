# FASTVMCTL-CP(1)

## NAME

fastvmctl-cp - copy regular files between the host and a sandbox

## SYNOPSIS

```text
fastvmctl cp <host-file> <sandbox>:<guest-path>
fastvmctl cp <sandbox>:<guest-path> <host-file>
```

## DESCRIPTION

Copies one regular file between the host and a running or sleeping sandbox.
A sleeping sandbox is woken first.

The guest side is written as `<sandbox>:<path>`. Relative guest paths resolve
against the sandbox workdir. A guest destination ending in `/` receives the
local basename. A local destination that is an existing directory receives the
guest basename.

File permissions are preserved where possible. Large files are transferred in
chunks.

## OPTIONS

No command-specific options.

Global options: `--socket`, `--help`.

## EXAMPLES

```sh
fastvmctl cp localfile.txt my-vm:remotefile.txt
fastvmctl cp my-vm:remotefile.txt localfile.txt
```

## LIMITS

Regular files only; directories are not copied recursively.

## SEE ALSO

[fastvmctl](fastvmctl.md), [fastvmctl exec](fastvmctl_exec.md),
[fastvmctl run](fastvmctl_run.md)
