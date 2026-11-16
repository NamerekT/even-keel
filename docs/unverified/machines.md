# What has not been verified: Machines

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: Machines](../verified/machines.md).

## The machines' stream through a real proxy (BTN-988)

The link between a hub and a machine (`docs/machines.md`) is covered by tests over a wire in memory and by the real HTTPS carrier on loopback: the stream's headers (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`), each frame written at once, the pinned certificate, and the machine's `link.buffered` notice when a connection opens and not one frame comes over it. It never ran through a real proxy, and no machine connects from elsewhere yet, so there is nothing to run before the service is cut into the two roles.

Assumed: nginx with its default `proxy_buffering on` honours `X-Accel-Buffering: no` for the stream; a proxy that does hold the stream gives the machine an open connection without frames, which is the case the notice tells from a break; the hub's pulse every 20 s keeps a Cloudflare tunnel (about 100 s idle) and nginx's `proxy_read_timeout` (60 s) from closing an idle stream; a proxy that ends TLS works with a token without a fingerprint. If a proxy answers the stream's request with its own error instead, or passes the first frames and holds the later ones, the machine only reconnects and its page shows it offline without the notice about the proxy.

To check, once a machine can be connected: a hub behind nginx with default settings and with `proxy_buffering off; proxy_read_timeout 1h;`, a Cloudflare tunnel, and an HTTPS-inspecting proxy or antivirus between the two.

## The chain over the link in a live installation (BTN-1216)

Since BTN-1216 the chain of every installation reaches its sessions through the hub ↔ machine protocol inside one process (`docs/machines.md`, "One process"): a call of the port is a numbered command and its result an event, the chain reads the machine from a mirror, and the first start of the new version makes the installation's own machine, its token and its consents by itself. This is covered by `src/machine/remote.test.ts`, the sample of the state database before the step and every scenario of `src/e2e/` with the scripted agent. It never ran on a live installation with real sessions.

Assumed: an update over a running chain picks its live sessions up and keeps the current task; every result and argument of the port survives JSON as the chain reads it; every folder a command names — a session's working folder, a slot — lies inside the project's folder the machine agreed to; a restart of the service in the middle of a launch leaves `command.interrupted` in the log and the launch to the chain's recovery of a starting task. If a session works in a folder outside its project's, its stop, resume or handover is refused and the chain pauses with "the machine refused …: the folder is outside the project's agreed ones"; if a command fails on the machine in a way the chain did not know before, it pauses with "the machine could not run …". Resume goes on once the cause is gone; the log of the service names the command.

To check: update a live installation with a chain running, watch the log for `machine:` and `link:` lines, run a task through a launch, a question, a limit, a handover and the cleanup after Done, restart the service mid-launch, and remove `state/machine/` between two starts (a new own machine is made, the chain goes on).
