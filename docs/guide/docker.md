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

The page listens on all interfaces **inside** the container. Compose publishes it on the host's loopback address. For a server or NAS, forward that port through SSH, or configure the proxy name under **Other names of the page** before exposing the page through an HTTPS proxy. See [the page on other devices](setup.md#reaching-the-page-from-another-machine). Compose publishes the port for [machines](#machines), 4749, on loopback too.

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

## Machines

A [machine of a hub](setup.md#a-machine-of-a-hub-preview) runs the hub's tasks and has no page of its own. Either side may be a container.

- **Hub and machines on hosts.** As in [the setup guide](setup.md#a-machine-of-a-hub-preview).
- **Hub in Docker, a machine on a host.** Inside its container the hub sees only the container's network. **+ Machine** therefore offers no network card's address: type the Docker host's name or address. Compose publishes the machines' port on loopback only. For machines on other hosts, add `EVEN_KEEL_MACHINES_PUBLISH=0.0.0.0` (or one of the host's addresses) to `.env` and run `docker compose up -d`. Alternatively, forward the port through a proxy ([Behind a proxy](setup.md#a-machine-of-a-hub-preview)). Open it only to the network the machines are on. Install the machine from npm with the window's command. A hub in an image has no git commit, so a machine from a clone cannot follow it. Instead, its page on the hub tells you to install the hub's version by hand.
- **A machine in Docker, the hub anywhere.** Save [compose.machine.yaml](../../compose.machine.yaml) as `compose.yaml` in an empty folder on the machine's host. In **+ Machine**, pick **Docker** and run the window's three steps in that folder:

  ```sh
  echo 'EVEN_KEEL_IMAGE_TAG=<the hub version>' > .env
  docker compose run --rm machine even-keel join '<connection string>'
  docker compose up -d
  ```

  The tag is required: a machine runs the hub's version, never `latest`. The join keeps the connection in the volume `machine-home`, and the string goes into no file. The `machine` service sets `EVEN_KEEL_MACHINE=1`. If it starts before the join, it waits for one instead of starting as a hub. `docker compose logs -f machine` shows it reach the hub. The image carries Node.js and git, and the machine downloads the agents' CLIs the hub names. Set its Git author with `docker compose exec machine git config --global user.name …` (and `user.email`), mount SSH keys as for the hub above, and sign in to accounts from the hub's page.
- **Hub and machine in Docker on one host.** Use [compose.hub-machine.yaml](../../compose.hub-machine.yaml) as the `compose.yaml` of the hub's folder: the hub keeps its volume `home`, and the machine gets its own. Start the hub, then type `even-keel` as the address in **+ Machine**. The machine reaches the hub by its Compose service name, and the connection string pins the hub's certificate, so the name needs no certificate of its own and port 4749 stays closed to other hosts. Then run the window's join and `docker compose up -d` in the same folder. Both services take one `EVEN_KEEL_IMAGE_TAG`. The address `even-keel` is remembered for the next strings: for a machine on another host, type the host's address again. For one more machine on this host, copy the `machine` service under another name with a volume of its own, and run the join with that name.
- **Hub and machines in Docker on several hosts.** The hub's host as in the second case, each machine's host as in the third.

### Updating machines

Every Compose folder has one version: `EVEN_KEEL_IMAGE_TAG` in its `.env`. Update the hub first. Change the number in its `.env` and run `docker compose pull && docker compose up -d` in its folder. With `compose.hub-machine.yaml` this one command updates the hub and its machines on that host. Then run the same in each other host's machine folder, after changing the number there. Until then, a machine of another version finishes its tasks and takes no new ones. Its page on the hub gives the `.env` line and the commands. A container never updates itself, not even when the hub refuses its version. For an image of your own built over ours, run `docker compose build --pull && docker compose up -d` instead.

## Updating

The default image tag is `latest`. To follow release candidates, put `EVEN_KEEL_IMAGE_TAG=next` in `.env`. To pin a version, use its number without the leading `v`. When updating a pinned install, change that number first.

Wait for active sessions to finish, then run the command shown in the page's update window from the Compose folder on the host:

```sh
docker compose pull && docker compose up -d
```

Compose replaces the container and reattaches the home volume and any mounted repositories. The new service runs its usual storage migrations at startup.
