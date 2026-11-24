# Sign-in to the page

One owner signs in to the page (BTN-1619), with no passwords: a passkey in one press, or the owner key. Each sign-in gives the browser a token of its own, listed and revoked in the settings group "Sign-in and devices". The tables are `people`, `access_tokens` and `passkeys` (`docs/storage.md`); the code is `src/guard.ts` (who is asked), `src/access/` (the book of tokens, the passkey ceremonies, the routes) and `web/src/pages/SignIn.tsx`, `SignInSettings.tsx`, `passkey.ts`.

## Who is asked

The guard (`guard()` in `src/guard.ts`) runs before every route and gives one verdict:

| Request | Verdict |
| --- | --- |
| From this machine by a loopback name (`localhost`, `127.0.0.1`, `[::1]`) | pass, no sign-in: the sessions' hooks (`EVEN_KEEL_URL`) and the browser on the machine itself |
| From this machine by any other name — a proxy such as `tailscale serve` or a Tailscale Service — when the owner key is set | asked to sign in, as from the network; the hook routes (`hookRouteOf`) still pass |
| No owner key set | as before: loopback only, no sign-in; the settings group shows a band "Sign-in is not set up" with the guide's link |
| `Authorization: Bearer <owner key>` | pass: scripts keep the key |
| A device token in the cookie (or as a Bearer) | pass, with the device: its `seen_at`/`seen_from` are noted (written at most once a minute) |
| `?token=<owner key>` in the address (an old link) | the device is signed in with the key and sent with 303 to the address without it |
| Not signed in, a page file (`GET` outside `/api/`) or `/api/auth/*` | a visit: the page loads and draws its sign-in screen |
| Anything else | 401 |

In Docker the host's browser reaches the hub through the container's gateway, not loopback: with the owner key set, `localhost` on the host is asked to sign in too, and the devices list shows the gateway's address for every device.

The address of a request behind a proxy on this machine is the first `X-Forwarded-For` (`addressOf`); from elsewhere the socket's, which a header cannot fake. The machines' link, the MCP gateway and the hooks are not touched by the sign-in.

A blocked service (a broken config) has no book: there the cookie holds the key itself and the server's form asks for it, as before BTN-1619.

## The routes

`accessRoute` (`src/access/routes.ts`) answers `/api/auth/*`; an error is 400 `{ error, notice }` with an `auth.*` code.

- Open to a visit: `GET state` (`AuthState`: signed in, key set, this device), `POST key { key }`, `POST passkey/options`, `POST passkey { response }`.
- Only signed in (else 401 `auth.signInFirst`): `POST passkey/register/options`, `POST passkey/register { response }`, `POST passkey/remove { id }`, `POST devices` (`DevicesView`; a POST as the page's other queries), `POST devices/revoke { id }`, `POST devices/revoke-others`, `POST sign-out`.

A sign-in sets the cookie (`HttpOnly`, `SameSite=Strict`, a year) and revokes the token the browser held before, so one browser is one row.

## Passkeys

WebAuthn through `@simplewebauthn/server` and `@simplewebauthn/browser`. The RP ID is the host name the page was opened by (`hostnameOf` of `Host`, which `allowedHosts` already admitted), the origin the browser's `Origin`: a passkey works only on the name it was made on, and its `host` is listed in its tip. Attestation `none`, discoverable credentials, user verification preferred. A challenge lives 5 minutes, is used once and is bound to its kind and host; at most 200 wait at once, since the routes are open.

A passkey needs a secure context — HTTPS or `localhost`: on plain `http://<address>` the screen has no passkey button, only the key with a line saying why. After a sign-in with the key, where passkeys work, the screen offers to add one on this device.

## The owner key

The owner key is `EVEN_KEEL_TOKEN` in the hub's `.env` (the "Owner key" row of the group, `PageToken`). A token signed in with it keeps the key's mark (`key_mark`, an HMAC of the key, never the key): when the key changes, live, `AccessBook.keyIs` revokes every token signed in with another key; passkey sign-ins stay. Whoever can open the `.env` on the server can always sign in: there is no reset by mail.

## Revoking

`AccessBook` keeps the live tokens in memory, so the guard stays synchronous, and writes every change through. A revoke — "Sign out" of a device, "Sign out everywhere but here", a new key, a sign-in over an old token — closes the open event streams of those devices (`EventHub.closeTagged`, each stream tagged by its device's token id), and the page loads the sign-in screen.

A stream the service ended after its 200 is reopened by the browser itself, and EventSource never says why a stream failed, so the page does not wait for a refused reconnect: on every failed stream, whether the browser retries or gave up, and each time the tab comes back into view (`visibilitychange`, where Safari may hold a dead stream with no error yet) `LiveConnection` asks `GET /api/auth/state` (BTN-1629). A 401 (a hub without sign-ins whose token changed) or `signedIn: false` stops the connection and reloads the page into the sign-in screen; a failed request or another status is a lost link, and the reconnecting banner stays. One question is in flight at a time.

## dev:fake

`/?signIn` draws the screen (`?signIn=nokey` — no owner key on the hub): the key is `owner-key`, a passkey always passes without the browser's dialog, and signing in drops the parameter. The settings group reads `web/src/live/fakeAuth.ts`: two passkeys and two devices, this browser one of them; its band follows the fake `EVEN_KEEL_TOKEN`.

```sh
npm run shot -- '/?signIn&lang=ru' .sign-in__card --size 390x844
npm run shot -- '/settings?lang=ru' --click '.settings-nav__item:has-text("Вход и устройства")' --wait '.sign-ins'
```
