# FASTVMCTL-EVENTS(1)

## NAME

fastvmctl-events - show recent daemon events

## SYNOPSIS

```text
fastvmctl events [-n N]
```

## DESCRIPTION

Shows recent sandbox and daemon events: state changes, warnings, auto-publish
decisions, snapshots, and memory activity.

## OPTIONS

| Option | Description |
|---|---|
| `-n, --limit N` | Number of events to show (default 50) |

## EXAMPLES

```sh
fastvmctl events
fastvmctl events -n 200
```

## SEE ALSO

[fastvmctl](fastvmctl.md), [fastvmctl get](fastvmctl_get.md)
