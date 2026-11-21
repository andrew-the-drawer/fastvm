# FASTVMCTL-SHELL(1)

## NAME

fastvmctl-shell - open an interactive shell in a sandbox

## SYNOPSIS

```text
fastvmctl shell <sandbox> [-- <command>...]
```

## DESCRIPTION

Opens an interactive PTY in the guest. The default command is `/bin/sh`.
`fastvmctl shell <sandbox>` is shorthand for `fastvmctl exec -it <sandbox> --
/bin/sh`.

## OPTIONS

No command-specific options.

## EXAMPLES

```sh
fastvmctl shell dev
fastvmctl shell dev -- /bin/bash
```

## SEE ALSO

[fastvmctl](fastvmctl.md), [fastvmctl exec](fastvmctl_exec.md)
