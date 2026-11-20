# Auto-publishing guest ports

`--auto-publish` discovers guest TCP listeners and publishes them on the host.
Off by default.

```sh
fastvmctl run -d --auto-publish --image python:3-alpine --name dev

fastvmctl exec dev -- python3 -m http.server 8000 --bind 0.0.0.0

curl http://127.0.0.1:8000/
```

## Behavior

- TCP listeners only, discovered every second via `/proc/net/tcp{,6}`
- Ports `>= 1024` map 1:1 to `127.0.0.1:<same-port>`
- Privileged ports require explicit `-p 80:80`
- Guest loopback-only listeners are ignored
- Occupied host ports are skipped, warned once, and retried; never reassigned
- Mappings are loopback-only and removed when the listener exits
- Implies networking; incompatible with `--no-net` and `--no-start`

`.fvmfile`:

```yaml
network:
  auto_publish: true
```

## Events

```sh
fastvmctl events -n 20
```

- `port`: mapped or unmapped
- `warning`: host port occupied; will retry

## Troubleshooting

- No event/mapping: confirm the server listens on IPv4:
  ```sh
  fastvmctl exec dev -- sh -c 'grep ":1F40" /proc/net/tcp'
  ```
- Python must use `--bind 0.0.0.0`; this guest kernel has no IPv6.
- Restart the daemon after upgrading, and rebuild base images with old agents.
