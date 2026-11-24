# Sign-in to the page

One owner signs in to the page (BTN-1619), with no passwords: a passkey in one press, or the owner key. Each sign-in gives the browser a token of its own, listed and revoked in the settings group "Sign-in and devices". The tables are `people`, `access_tokens` and `passkeys` (`docs/storage.md`); the code is `src/guard.ts` (who is asked), `src/access/` (the book of tokens, the passkey ceremonies, the routes) and `web/src/pages/SignIn.tsx`, `SignInSettings.tsx`, `passkey.ts`.

## Who is asked

The guard (`guard()` in `src/guard.ts`) runs before every route and gives one verdict:

| Request | Verdict |
| --- | --- |
| From this machine by a loopback name (`localhost`, `127.0.0.1`, `[::1]`) | pass, no sign-in: the sessions' hooks (`EVEN_KEEL_URL`) and the browser on the machine itself |
| From this machine by any other name — a proxy such as `tailscale serve` or a Tailscale Service — when the owner key is set or an invitation turned the sign-in on | asked to sign in, as from the network; the hook routes (`hookRouteOf`) still pass |
| No owner key set and the sign-in not turned on | as before: loopback only, no sign-in; the settings group shows a band "Sign-in is not set up" whose button invites a device |
| `Authorization: Bearer <owner key>` | pass: scripts keep the key |
| A device token in the cookie (or as a Bearer) | pass, with the device: its `seen_at`/`seen_from` are noted (written at most once a minute) |
| `?token=<owner key>` in the address (an old link) | the device is signed in with the key and sent with 303 to the address without it |
| Not signed in, a page file (`GET` outside `/api/`) or `/api/auth/*` | a visit: the page loads and draws its sign-in screen |
| Anything else | 401 |

In Docker the host's browser reaches the hub through the container's gateway, not loopback: with the owner key set, `localhost` on the host is asked to sign in too, and the devices list shows the gateway's address for every device.

**Without the key** (BTN-1656) a hub takes devices by invitation alone. The first "Let in" turns the sign-in on: the mark `sign_in_on` (step 83, `AccessBook.signInOn`, `DeviceBook.signInOn` for the guard) makes a proxy's name ask as the key does. It is a mark of its own, not "a live token is there", so "Sign out everywhere" or signing the last device out never opens the page again. The browser that pressed that first "Let in" by a proxy's name and had no token of its own gets one with the answer (`invites/admit`), else it would shut itself out; on a loopback name it needs none. Open pages of other browsers by the proxy's name get 401 from then and land on the sign-in screen, which without the key has no key field, only the passkey and the line about an invitation. The key stays the spare way in: set later, it signs in as before, and the mark stays. "Turn sign-in off" in the "Sign-in by key" card (`POST sign-in/off`, only without the key, behind a confirmation) drops the mark and signs every device out, so a later invitation revives no old token; with the key set it answers `auth.signInKeepsKey`. Without the key the OAuth callback's cookie is signed with a secret of the process instead (`oauthCallbackCookie`).

The address of a request behind a proxy on this machine is the first `X-Forwarded-For` (`addressOf`); from elsewhere the socket's, which a header cannot fake. The machines' link, the MCP gateway and the hooks are not touched by the sign-in.

A blocked service (a broken config) has no book: there the cookie holds the key itself and the server's form asks for it, as before BTN-1619.

## The routes

`accessRoute` (`src/access/routes.ts`) answers `/api/auth/*`; an error is 400 `{ error, notice }` with an `auth.*` code.

- Open to a visit: `GET state` (`AuthState`: signed in, key set, a passkey made on this request's host name, this device), `POST key { key }`, `POST passkey/options`, `POST passkey { response }`, `POST invite/open { link }` and `POST invite/wait` (`JoinView`, [Invitations](#invitations)).
- Only signed in (else 401 `auth.signInFirst`): `POST passkey/register/options`, `POST passkey/register { response }`, `POST passkey/remove { id }`, `POST devices` (`DevicesView`; a POST as the page's other queries), `POST devices/revoke { id }`, `POST devices/revoke-others`, `POST invites/create` (`InviteMade`), `POST invites/admit|decline|cancel { id }`, `POST sign-in/off`, `POST sign-out`. `DevicesView.signInOn` says an invitation turned the sign-in on.

A sign-in sets the cookie (`HttpOnly`, `SameSite=Strict`, a year) and revokes the token the browser held before, so one browser is one row.

## Passkeys

WebAuthn through `@simplewebauthn/server` and `@simplewebauthn/browser`. The RP ID is the host name the page was opened by (`hostnameOf` of `Host`, which `allowedHosts` already admitted), the origin the browser's `Origin`: a passkey works only on the name it was made on, and its row in the settings shows that name. Attestation `none`, discoverable credentials, user verification preferred. A challenge lives 5 minutes, is used once and is bound to its kind and host; at most 200 wait at once, since the routes are open.

A passkey needs a secure context — HTTPS or `localhost`: on plain `http://<address>` the screen has no passkey button, only the key with a line saying why. It also needs a name: WebAuthn refuses an IP address as an RP ID, so on `http://127.0.0.1` or any v4/v6 address (`passkeyHost` in `src/access/passkey-host.ts`, shared with the page) neither the sign-in screen nor "Sign-in and devices" shows a passkey button, a line says to open `localhost` or an HTTPS name instead, and the server answers both options calls with `auth.passkeyByName` (BTN-1632). Where passkeys work but the hub has none made on this name (`AuthState.passkeyHere`, BTN-1631), the button gives way to a line too: the browser's dialog would list only the phone and security keys. After a sign-in with the key, where passkeys work, the screen offers to add one on this device.

A device signed in with a passkey keeps that passkey's host name (`access_tokens.passkey_host`): its row in the devices list tags it "passkey on `name`" instead of a bare "passkey", so two "Chrome on Windows" tell apart. Tokens made before BTN-1631 have none.

A browser answers `NotAllowedError` both when the person closes its dialog and when it refuses with no dialog at all — Telegram's in-app browser on iOS has `PublicKeyCredential` and refuses at once (BTN-1630). `ceremony` in `web/src/pages/passkey.ts` tells them apart: a refusal within `NO_DIALOG_MS` (1 s) with the page never losing focus or visibility is the browser's, and the screen and the settings group say the browser cannot use passkeys and to open the page in Safari or Chrome; a slower one, or one after the page lost focus, is "No passkey was picked".

## The owner key

The owner key is `EVEN_KEEL_TOKEN` in the hub's `.env` (the "Owner key" row of the group, `PageToken`). A token signed in with it keeps the key's mark (`key_mark`, an HMAC of the key, never the key): when the key changes, live, `AccessBook.keyIs` revokes every token signed in with another key; passkey sign-ins stay. Whoever can open the `.env` on the server can always sign in: there is no reset by mail.

## Invitations

A new device can sign in without the key: a device signed in invites it (BTN-1655, `InviteDesk` in `src/access/invites.ts`), as a Tailscale invitation does. "Invite a device" at the bottom of the "Devices" card posts `invites/create` and opens `InviteDialog`: the QR (`QrCode`, `web/src/ui/Qr.tsx`, drawn on the page by `uqr`, no network) and the link `<page origin>/invite#<secret>` with a copy button, a countdown, and "Waiting for the link to be opened". The secret is in the fragment, so loading the page never sends it to the server or a proxy's log; the origin is the one the dialog's page is open by, and on a loopback name the dialog warns that another device cannot open it.

- **Table** `device_invites` (step 82): the link and the claim only as SHA-256; `waiting` (unopened) → `opened` (claimed, with the digits) → `admitted` / `declined` / `cancelled` → `used` (the token collected). An expired one is dropped from the table a day later. The same step adds `access_tokens.invite_id`: the device's row is tagged "by invitation".
- **Open.** `invite/open { link }` from the new device: the first browser to open a live link claims it — a claim secret in the cookie `even-keel-invite` (`HttpOnly`, `SameSite=Strict`, `Path=/api/auth/invite/`, never on screen) — and two random digits (00–99) are drawn. The same browser opening it again gets its own claim back; any other gets `used` and the owner hears nothing, so a link cannot be flooded with requests. A wrong, expired or cancelled-before-opening link is one answer, `gone`.
- **Wait.** `invite/wait` is a long request: it answers at once when the invitation is decided, else after `WAIT_MS` (25 s) with `waiting`, and the page asks again. `admitted` comes with the device's own token in the sign-in cookie, the same as after the key; only the claiming browser can collect it, since the claim is the cookie, not the link or the digits.
- **Decide.** The dialog and the card read "Sign-in and devices" anew on the event `devices` of the stream (`InviteDesk.changed` → `EventHub.broadcast`, `LiveSource.onDevices`), so "Waiting…" turns into "<device> opened the link at <time>", the digits large, "Let in" and "Decline". "Let in" is for a person who saw the same digits on the new device: a link that leaked and was opened first by someone else shows other digits. Any device signed in can decide. A closed dialog leaves the invitation as a row of the "Devices" card with "Let in" and "Decline" once opened, and "Cancel"; nothing else on the page tells about it, so it is never approved by habit.
- **Limits.** A link lives `INVITE_MS` (10 minutes), is used once and dies on cancel; at most `MAX_INVITES` (5) wait at once (`auth.invitesFull`). The open routes take `INVITE_CALLS` (30) calls a minute per address (`RateLimit`, `src/access/rate.ts`), the next is 429 `auth.inviteSlowDown`.
- **Without the key** the invitation works the same, and its first "Let in" turns the sign-in on ([Who is asked](#who-is-asked)); the band "Sign-in is not set up" offers it.
- **The new device** (`web/src/pages/InviteJoin.tsx`, drawn by `main.tsx` on `/invite` before the page) shows the digits and "Waiting for approval where the link was made", then its own screen for each end — declined, expired, cancelled, used by another device, gone — or, let in, the passkey offer of the key's sign-in and the page. A browser signed in already does not take the link: the screen says so and leads to the page, since the link may be meant for another device.
- The sign-in screen says under the key field where to get an invitation, with a link to the guide.

## Revoking

`AccessBook` keeps the live tokens in memory, so the guard stays synchronous, and writes every change through. A revoke — "Sign out" of a device, "Sign out everywhere but here", a new key, a sign-in over an old token — closes the open event streams of those devices (`EventHub.closeTagged`, each stream tagged by its device's token id), and the page loads the sign-in screen.

A stream the service ended after its 200 is reopened by the browser itself, and EventSource never says why a stream failed, so the page does not wait for a refused reconnect: on every failed stream, whether the browser retries or gave up, and each time the tab comes back into view (`visibilitychange`, where Safari may hold a dead stream with no error yet) `LiveConnection` asks `GET /api/auth/state` (BTN-1629). A 401 (a hub without sign-ins whose token changed) or `signedIn: false` stops the connection and reloads the page into the sign-in screen; a failed request or another status is a lost link, and the reconnecting banner stays. One question is in flight at a time.

## dev:fake

`/?signIn` draws the screen (`?signIn=nokey` — no owner key on the hub, `?signIn=elsewhere` — passkeys made only on other names): the key is `owner-key`, a passkey always passes without the browser's dialog (`?signIn=nopasskeys` — refused at once, as by a browser without passkeys), and signing in drops the parameter. The settings group reads `web/src/live/fakeAuth.ts`: three passkeys on two names and four devices, two of them "Chrome on Windows", one by invitation, this browser one of them; its band follows the fake `EVEN_KEEL_TOKEN` (unset by default), `&signInOn` starts with the sign-in an invitation turned on, and a fake "Let in" turns it on. `&invites` starts with two invitations waiting, one opened; an invitation made in the dialog is opened by a fake phone 3 s later, digits 47. `/invite` is a browser signed in already, `/invite?signIn` the new device: let in 3 s after opening, or `&invite=declined|expired|cancelled|waiting|used|gone`.

```sh
npm run shot -- '/?signIn&lang=ru' .sign-in__card --size 390x844
npm run shot -- '/settings?lang=ru' --click '.settings-nav__item:has-text("Вход и устройства")' --wait '.sign-ins'
npm run shot -- '/settings?lang=ru&signInOn' --click '.settings-nav__item:has-text("Вход и устройства")' --wait '.sign-ins'
npm run shot -- '/settings?lang=ru&invites' --click '.settings-nav__item:has-text("Вход и устройства")' --click 'button:has-text("Пригласить устройство")' --wait '.invite__qr'
npm run shot -- '/invite?signIn&invite=waiting&lang=ru#fake' .sign-in__card --wait '.sign-in__digits' --size 390x844
```
