# FASTVMCTL-SNAPSHOT(1)

## NAME

fastvmctl-snapshot - create, list, or remove snapshots

## SYNOPSIS

```text
fastvmctl snapshot <sandbox> [--name NAME]
fastvmctl snapshot ls
fastvmctl snapshot rm <snapshot>...
```

## DESCRIPTION

Saves a sandbox's RAM/CPU state and writable disk under the daemon data
directory, then resumes the source sandbox. Prints the snapshot name for use with
`run --from-snapshot`.

## OPTIONS

| Option | Description |
|---|---|
| `--name NAME` | Snapshot name (default: `<sandbox>-<timestamp>`) |

## EXAMPLES

```sh
fastvmctl snapshot dev
fastvmctl snapshot dev --name before-upgrade
fastvmctl snapshot ls
fastvmctl run --from-snapshot before-upgrade --name dev2
fastvmctl snapshot rm before-upgrade
```

## LIMITS

Host volumes are not snapshotted yet. Restored sandboxes get a new TAP/IP and
do not inherit ports, env, auto-publish, or `no-auto-sleep`.

## SEE ALSO

[fastvmctl](fastvmctl.md), [Snapshots](../SNAPSHOT.md)
