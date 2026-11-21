# FASTVMCTL-RESUME(1)

## NAME

fastvmctl-resume - boot or wake a sandbox

## SYNOPSIS

```text
fastvmctl resume [sandbox]
fastvmctl resume --name <sandbox>
```

## DESCRIPTION

Makes an existing sandbox active:

- `Created` → boot
- `Paused` → wake
- `Dormant` → restore

Running or idle sandboxes return an error; use `exec` instead.

## OPTIONS

| Option | Description |
|---|---|
| `--name NAME` | Sandbox name/ID instead of positional argument |

## EXAMPLES

```sh
fastvmctl resume dev
fastvmctl resume --name dev
```

## SEE ALSO

[fastvmctl](fastvmctl.md), [fastvmctl pause](fastvmctl_pause.md),
[Sandbox lifecycle](../LIFECYCLE.md)
