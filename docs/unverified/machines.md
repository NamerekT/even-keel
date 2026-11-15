# What has not been verified: Machines

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: Machines](../verified/machines.md).

## The machines' stream through a real proxy (BTN-988)

The link between a hub and a machine (`docs/machines.md`) is covered by tests over a wire in memory and by the real HTTPS carrier on loopback: the stream's headers (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`), each frame written at once, the pinned certificate, and the machine's `link.buffered` notice when a connection opens and not one frame comes over it. It never ran through a real proxy, and nothing starts the link yet, so there is nothing to run before the service is cut into the two roles.

Assumed: nginx with its default `proxy_buffering on` honours `X-Accel-Buffering: no` for the stream; a proxy that does hold the stream gives the machine an open connection without frames, which is the case the notice tells from a break; the hub's pulse every 20 s keeps a Cloudflare tunnel (about 100 s idle) and nginx's `proxy_read_timeout` (60 s) from closing an idle stream; a proxy that ends TLS works with a token without a fingerprint. If a proxy answers the stream's request with its own error instead, or passes the first frames and holds the later ones, the machine only reconnects and its page shows it offline without the notice about the proxy.

To check, once a machine can be connected: a hub behind nginx with default settings and with `proxy_buffering off; proxy_read_timeout 1h;`, a Cloudflare tunnel, and an HTTPS-inspecting proxy or antivirus between the two.
