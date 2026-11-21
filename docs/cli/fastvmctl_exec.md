# FASTVMCTL-EXEC(1)

## NAME

fastvmctl-exec - run a command in a sandbox

## SYNOPSIS

```text
fastvmctl exec <sandbox> -- <command> [args...]
```

## DESCRIPTION

Runs a non-interactive command in a running or sleeping sandbox and prints its
stdout/stderr. A sleeping sandbox is woken first.

## OPTIONS

| Option | Description |
|---|---|
| `-i, --interactive` | Attach an interactive PTY |
| `-t, --tty` | Allocate a TTY |

## EXAMPLES

```sh
fastvmctl exec dev -- uname -a
fastvmctl exec dev -- sh -c 'grep MemFree /proc/meminfo'
fastvmctl exec -it dev -- /bin/bash
```

## SEE ALSO

[fastvmctl](fastvmctl.md), [fastvmctl shell](fastvmctl_shell.md),
[fastvmctl cp](fastvmctl_cp.md)
