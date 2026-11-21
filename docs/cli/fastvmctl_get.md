# FASTVMCTL-GET(1)

## NAME

fastvmctl-get - show one sandbox as JSON

## SYNOPSIS

```text
fastvmctl get <sandbox>
```

## DESCRIPTION

Prints the complete sandbox record as indented JSON: state, image, resources,
network allocation, volumes, ports, counters, timestamps, and errors.

## OPTIONS

No command-specific options.

## EXAMPLES

```sh
fastvmctl get dev
fastvmctl get dev | grep network_enabled
```

## SEE ALSO

[fastvmctl](fastvmctl.md), [fastvmctl ps](fastvmctl_ps.md)
