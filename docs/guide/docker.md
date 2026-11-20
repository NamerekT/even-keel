# Installing with Docker

The Even Keel image runs on Linux amd64 and arm64. Docker Compose starts the service and its agents as the `node` user (UID 1000).

## First start

Save [compose.yaml](../../compose.yaml) in an empty folder on the Docker host. Run the following commands in that folder. On Linux or macOS, this creates a private `.env` with a fresh page token.

```sh
(umask 077 && printf 'EVEN_KEEL_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env)
```

Start Even Keel and open `http://localhost:4747` on the host. Enter the token from `.env` when prompted, then follow the [setup wizard](setup.md#the-first-start).

```sh
docker compose up -d
docker compose logs -f even-keel
```

The page listens on all interfaces **inside** the container. Compose publishes it on the host's loopback address. For a server or NAS, forward that port through SSH, or configure the proxy name under **Other names of the page** before exposing the page through an HTTPS proxy. See [the page on other devices](setup.md#reaching-the-page-from-another-machine).

## Data, accounts and repositories

The named volume `home` holds `/home/node`. This includes the service data in `/home/node/.local/share/even-keel` (database, logs and checked CLIs), agent account folders and Git configuration. Sign in to agent accounts on the page. A repository cloned under `/home/node` also survives container replacement. Use the same Compose folder and project name each time to reuse the volume. `docker compose down` keeps it, while `docker compose down -v` deletes it.

To use a host checkout, add a `compose.override.yaml` beside `compose.yaml` and run `docker compose up -d` again. For example:

```yaml
services:
  even-keel:
    volumes:
      - /srv/even-keel/projects:/projects
```

Mount the whole checkout, including its Git directory and worktrees. Give UID 1000 write access, then enter the container path (for example `/projects/demo`) when adding the project. Agents can modify the host files mounted there.

Set the Git author in the setup wizard. For SSH remotes, provision a dedicated key and verified `known_hosts` in a private host directory and mount it read-only at `/home/node/.ssh` (for example `/srv/even-keel/ssh:/home/node/.ssh:ro`). The key must be readable by UID 1000 with mode 0600. For HTTPS, configure a Git credential helper in the container. For example, with a dedicated Git credential file mounted read-only at `/run/secrets/git-credentials`, run:

```sh
docker compose exec even-keel git config --global credential.helper 'store --file=/run/secrets/git-credentials'
```

Keep these files on the host, outside the repository and image. The token in Compose's `.env` grants access to the Even Keel page. Tracker credentials are entered separately in **Settings → Trackers and CI**.

## Updating

The default image tag is `latest`. To follow release candidates, put `EVEN_KEEL_IMAGE_TAG=next` in `.env`. To pin a version, use its number without the leading `v`. When updating a pinned install, change that number first.

Wait for active sessions to finish, then run the command shown in the page's update window from the Compose folder on the host:

```sh
docker compose pull && docker compose up -d
```

Compose replaces the container and reattaches the home volume and any mounted repositories. The new service runs its usual storage migrations at startup.
