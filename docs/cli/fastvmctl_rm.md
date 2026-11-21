# FASTVMCTL-RM(1)

## NAME

fastvmctl-rm - delete sandboxes

## SYNOPSIS

```text
fastvmctl rm <sandbox>...
```

## DESCRIPTION

Deletes one or more sandboxes, their runtime state, network attachment, and
writable CoW volume. Images and saved snapshots are not deleted.

## OPTIONS

No command-specific options.

## EXAMPLES

```sh
fastvmctl rm dev
fastvmctl rm dev test-1 test-2
```

## SEE ALSO

[fastvmctl](fastvmctl.md), [fastvmctl ps](fastvmctl_ps.md)
