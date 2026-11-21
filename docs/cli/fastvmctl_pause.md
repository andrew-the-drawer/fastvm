# FASTVMCTL-PAUSE(1)

## NAME

fastvmctl-pause - pause or offload a sandbox

## SYNOPSIS

```text
fastvmctl pause <sandbox> [--deep]
```

## DESCRIPTION

Pauses the sandbox vCPUs. With `--deep`, memory is offloaded to disk and the
sandbox becomes dormant.

## OPTIONS

| Option | Description |
|---|---|
| `--deep` | Offload guest memory to disk |

## EXAMPLES

```sh
fastvmctl pause dev
fastvmctl pause dev --deep
```

## SEE ALSO

[fastvmctl](fastvmctl.md), [fastvmctl resume](fastvmctl_resume.md),
[Sandbox lifecycle](../LIFECYCLE.md)
