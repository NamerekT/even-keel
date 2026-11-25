# The page

`http://localhost:4747` by default. The page can be installed as an app (the install button in the address bar of Chrome or Edge) and then opens in its own window; browsers offer this on `localhost` or over HTTPS only.

### Answering from the phone

Sessions can be answered from the page's chat or the tracker.

To answer them in Claude's own app as well, use Remote Control: a Claude account added from the page with a claude.ai sign-in has it on, and the page links each session's Remote Control. For an account where it is off, "Turn on Remote Control" in the account row's menu or the session panel turns it on from the account's next session. This also resolves a pending edit to that setting.

Codex sessions have no remote control: they run through `codex exec`, whose threads the Codex app and ChatGPT on the phone do not list, so they are answered only from the page's chat or the tracker ([docs/sessions/codex.md](../sessions/codex.md#codex-btn-168-srccodex)).

### Reaching the page from another machine

By default the page listens on `127.0.0.1` only, and nothing else on the network sees it. That is on purpose: the page starts sessions with automatic permissions, writes answers into waiting sessions and signs Claude accounts in and out, so whoever reaches it drives your machine. Even Keel also refuses requests that another site could send from your browser; when a proxy sits in front, keep the response headers it passes on. The checks themselves are in [the sign-in reference](../web/sign-in.md#the-checks-on-every-request).

Open Even Keel directly in a tab or its installed app: the page and its sign-in screen cannot be embedded in a frame.

Two ways to reach it from elsewhere:

- **A proxy on the same machine** (recommended). For example a Tailscale Service, `tailscale serve --service=svc:even-keel --https=443 http://localhost:4747`, which also gives the page HTTPS, so it can be installed as an app. The proxy forwards the name it was reached by, so put that name into `allowedHosts`: `"allowedHosts": ["even-keel.example.ts.net"]`. Then turn the sign-in on: invite your first device ([below](#signing-in-on-a-new-device)) or set the owner key (`EVEN_KEEL_TOKEN` in `.env`). From then a request by the proxy's name is asked to sign in, though it comes from loopback. Until then who gets in is decided by the proxy alone — the tailnet's access rules — and the settings say "Sign-in is not set up".
- **Listening on the network.** Set `EVEN_KEEL_HOST` in `.env` to `0.0.0.0` or the machine's address, put the names or addresses you open it by into `allowedHosts` (the configured address itself is let in), and set `EVEN_KEEL_TOKEN` in `.env`. Without the key the service does not start. Plain HTTP shows the key to anyone on the way and has no passkeys, so prefer a proxy with HTTPS.

#### Signing in

`EVEN_KEEL_TOKEN` is the **owner key**: 16+ characters, e.g. `node -e "console.log(crypto.randomBytes(24).toString('hex'))"`. Once it is set, a browser that is not signed in gets the sign-in screen:

- **Passkey** — one button: the browser's own passkey dialog (Face ID, Windows Hello, a phone, a security key). It needs HTTPS or `localhost`; on plain `http://<address>` the screen offers only the key and says why. It also needs a name, not an IP address: opened as `http://127.0.0.1` or any other IP, the page has no passkey buttons — open it by `localhost` or an HTTPS name. A passkey works only on the name the page was opened by when it was added: its row in the settings shows that name, and on a name with no passkey yet the screen has no passkey button, only the key. An app's built-in browser (a link opened in a messenger) may have no passkeys at all: the screen then says so — open the page in Safari or Chrome.
- **Owner key** — the first sign-in and the way back in: whoever can read the hub's `.env` can always sign in, so lost every passkey — sign in with the key and add a new one. After the key the screen offers to add a passkey on this device.

Each sign-in gives the browser a token of its own. Settings → **Sign-in and devices** lists the passkeys (add, remove) and the devices signed in — when each was last seen and from where — with "Sign out" on each and "Sign out everywhere but here"; a device signed out loses its open page at once and is asked to sign in again. Changing the owner key signs out every device that signed in with the old key; passkey sign-ins stay. An old link with `?token=<key>` still works: it signs the browser in and drops the key from the address. Scripts send `Authorization: Bearer <key>`.

#### Signing in on a new device

A new phone or laptop does not need the owner key: invite it from a device that is signed in already.

1. On the signed-in device open Settings → **Sign-in and devices** and press **Invite a device** under "Devices". The link goes to the address the page is open by. On a page open by `localhost` it never goes to `localhost`, which another device cannot open: it goes to the address the page was last opened by from outside, with a choice when there were several, and when there was none yet the window asks for it — type the address the new device opens the page by, such as the proxy's HTTPS name with its port. Even Keel remembers it for the next invitation; **Another address** in the window types a different one.
2. On the new device scan the QR with its camera, or open the link from **Copy the link**. It shows two digits and waits. Where Even Keel is installed as an app (on an iPhone, "Add to Home Screen"), press **Scan a QR** on its sign-in screen instead: the system camera opens the link in the browser, which keeps its sign-in apart from the app's, so the app would still ask to sign in.
3. On the first device the window now says which device opened the link and shows its two digits. Press **Let in** only if they are the same as on the new device; otherwise **Decline**.
4. The new device signs in and offers to add a passkey, so next time it needs nothing.

A link lives 10 minutes and lets in one device: the first one to open it takes it, any other gets "already used". Closing the window does not cancel the invitation: it stays a row under "Devices" with **Let in**, **Decline** and **Cancel** until it is decided or expires, and any signed-in device can decide it. A browser that is signed in already does not take a link.

Invitations work without the owner key too. On such a hub the first **Let in** turns the sign-in on: from then the proxy's name asks every browser to sign in, and the device you pressed **Let in** on stays signed in. Signing devices out does not turn it off. To go back to a hub that asks nobody, press **Turn sign-in off** under "Sign-in by key": every device is signed out. Lost every device? Open the page by `localhost` on the hub itself, or set the owner key and sign in with it.

Requests by a loopback name — `localhost`, `127.0.0.1`, `[::1]` — go without a sign-in: the sessions' hooks reach the page so, and so does a browser on the machine itself. Any proxy or tunnel on the same machine that forwards a loopback name, or runs before the sign-in is on, must control who can reach Even Keel itself.

Once the forwarded name is accepted by the `Host` check, a public tunnel without its own authentication lets anyone who knows its address drive the page and start sessions with automatic permissions.

`allowedHosts` permits a name; it does not authenticate visitors. HTTPS encrypts the connection but does not decide who may enter.

The page and the MCP gateway trust every OS user account on this machine, not just the account running Even Keel.

Another local user can call the page at `127.0.0.1:4747` or the gateway at `127.0.0.1:4748` (the default ports) without a token, including the tasks server's tools for any project, and can run code as the service account.

Install Even Keel on a machine with no other users, or trust every user as much as the service account.
