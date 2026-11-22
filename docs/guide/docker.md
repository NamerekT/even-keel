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

## Your own tools

The image carries Node.js, git, SSH and curl, nothing a project may need besides: Python, a compiler, system libraries. They cannot be installed from inside, since the container runs as `node`, without sudo and with `no-new-privileges`. A `docker compose exec -u root even-keel apt-get install …` does work, but it changes only that container: the next update replaces it with a fresh one, and the tools are gone.

Build an image of your own over ours instead. Put a `Dockerfile` beside `compose.yaml`:

```dockerfile
ARG EVEN_KEEL_IMAGE_TAG=latest
FROM ghcr.io/namerekt/even-keel:${EVEN_KEEL_IMAGE_TAG}
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv build-essential \
    && rm -rf /var/lib/apt/lists/*
USER node
```

The last line matters: the service and its agents must run as `node`, the owner of the volume. Then tell Compose to build it, in `compose.override.yaml`:

```yaml
services:
  even-keel:
    image: even-keel-own:${EVEN_KEEL_IMAGE_TAG:-latest}
    build:
      context: .
      args:
        EVEN_KEEL_IMAGE_TAG: ${EVEN_KEEL_IMAGE_TAG:-latest}
```

The build argument passes the tag from `.env` to the `FROM` line, so a pinned version or `next` holds for your image too. The image gets a name of its own so that a `docker compose pull` does not put ours in its place. Build and start it:

```sh
docker compose build --pull && docker compose up -d
```

Everything under `/home/node` survives an update, as it lives in the volume: the database, the account folders, the checked CLIs and the clones. Tools that install into the home folder may go there instead of into an image, for example mise, uv or rustup. Their folder must be on the service's `PATH` for the agents to find them, for example `ENV PATH=/home/node/.local/bin:$PATH` in your `Dockerfile`, or the image's whole `PATH` with that folder in front under `environment` in `compose.override.yaml`.

## Stopping and backing up

`docker compose stop`, `down` and the `up -d` of an update give Even Keel 30 seconds to close (`stop_grace_period` in the Compose files), while it needs up to 15. Without that setting, Docker kills the container after 10 seconds, so a Compose file of your own needs it too.

The [automatic copies](setup.md#stored-state) of the database lie in the same volume as the database, so losing the volume loses them as well. To keep them elsewhere, mount a host folder that UID 1000 can write, for example `/srv/even-keel/backups:/backups`, and set **Settings** → **Backups** → **Copies folder** to `/backups`. Those copies hold the database only. The account sign-ins, the machine's own folder and cloned repositories stay in the volume.

To copy the whole volume, stop the service and pack `/home/node` into an archive in the Compose folder:

```sh
docker compose stop
docker compose run --rm --no-deps --user root -v "$PWD:/backup" even-keel \
  sh -c "tar czf /backup/even-keel-home.tgz -C /home/node . && chmod 600 /backup/even-keel-home.tgz && chown $(id -u):$(id -g) /backup/even-keel-home.tgz"
docker compose start
```

The archive holds the sign-ins, the tracker credentials and the page's settings in the clear, so keep it as private as `.env`. To put it back, for example on a new host or after `down -v`, run the following in the Compose folder with the archive in it:

```sh
docker compose down
docker compose run --rm --no-deps --user root -v "$PWD:/backup:ro" even-keel \
  sh -c 'find /home/node -mindepth 1 -delete && tar xzpf /backup/even-keel-home.tgz -C /home/node'
docker compose up -d
```

This replaces everything in the volume. For a machine's folder, use the service name `machine` instead of `even-keel`. With `compose.hub-machine.yaml`, copy each service into an archive of its own name.

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

  The tag is required: a machine runs the hub's version, never `latest`. The join keeps the connection in the volume `machine-home`, and the string goes into no file. The `machine` service sets `EVEN_KEEL_MACHINE=1`. If it starts before the join, it waits for one instead of starting as a hub. `docker compose logs -f machine` shows it reach the hub. With **Machine name** left empty, the hub names the machine by its host name, which the file sets to `even-keel-machine`, so the name survives a recreated container. Type a name in the window, or change `hostname:` before the join, to tell machines on several hosts apart. The image carries Node.js and git, not the agents' CLIs. A provider on **Checked** at the hub: once the hub's own copy is downloaded with your consent, the machine downloads its own copy of the same version by itself, and its chain waits only for the bytes. If the hub has no copy yet, the pause names the machine: download the copy on the hub, and the machine follows. A provider on **Yours** needs its CLI installed in the container, or in an image of your own. Set its Git author with `docker compose exec machine git config --global user.name …` (and `user.email`), mount SSH keys as for the hub above, and sign in to accounts from the hub's page.
- **Hub and machine in Docker on one host.** Use [compose.hub-machine.yaml](../../compose.hub-machine.yaml) as the `compose.yaml` of the hub's folder: the hub keeps its volume `home`, and the machine gets its own. Start the hub, then type `even-keel` as the address in **+ Machine**. The machine reaches the hub by its Compose service name, and the connection string pins the hub's certificate, so the name needs no certificate of its own and port 4749 stays closed to other hosts. Then run the window's join and `docker compose up -d` in the same folder. Both services take one `EVEN_KEEL_IMAGE_TAG`. The address `even-keel` is remembered for the next strings: for a machine on another host, type the host's address again. For one more machine on this host, copy the `machine` service under another name with a volume and a `hostname:` of its own, and run the join with that name. The hub's host name is `even-keel` in both Compose files, so its own machine is named so as well.
- **Hub and machines in Docker on several hosts.** The hub's host as in the second case, each machine's host as in the third.

### Updating machines

Every Compose folder has one version: `EVEN_KEEL_IMAGE_TAG` in its `.env`. A machine's agent sessions run inside its container, so a `stop`, `down` or the `up -d` of an update ends them. Wait for the sessions of the machines you update to finish, as for the hub. A session cut off this way stays its task's current session, and an answer from the page's chat continues it. Update the hub first. Change the number in its `.env` and run `docker compose pull && docker compose up -d` in its folder. With `compose.hub-machine.yaml` this one command updates the hub and its machines on that host. Then run the same in each other host's machine folder, after changing the number there. Until then, a machine of another version finishes its tasks and takes no new ones. Its page on the hub gives the `.env` line and the commands. A container never updates itself, not even when the hub refuses its version. For an image of your own built over ours, run `docker compose build --pull && docker compose up -d` instead.

## Updating

The default image tag is `latest`. To follow release candidates, put `EVEN_KEEL_IMAGE_TAG=next` in `.env`. To pin a version, use its number without the leading `v`. When updating a pinned install, change that number first.

Wait for active sessions to finish, then run one of the two commands shown in the page's update window from the Compose folder on the host. With our image:

```sh
docker compose pull && docker compose up -d
```

With [your own image](#your-own-tools) over ours, rebuild it on the new version instead: `pull` would leave it as it is, and the page would keep offering the update.

```sh
docker compose build --pull && docker compose up -d
```

From inside the container the two images look alike, so the window shows both. Compose replaces the container and reattaches the home volume and any mounted repositories. The new service runs its usual storage migrations at startup.

## Moving a host installation into Docker

The data folder of an installation on the host cannot be copied into the volume as is. Its database stores the host's paths: project checkouts, agent account folders, task worktrees and the folders of running sessions. On Windows, these are Windows paths. Only the settings and projects move. Everything else starts afresh in the container:

- tracker profiles and their credentials, the OpenRouter management keys and the agents' sign-ins;
- tasks of a project on the built-in tracker (keep such a project on the host for now);
- the chain's state, the launch log, the statistics and the database copies.

1. Let the chains finish their tasks, then stop Even Keel on the host.
2. Export the settings and projects. The command belongs to a clone of Even Keel, not to the npm package. For an npm installation, clone the same version, run `npm install` in the clone and point it at the installation's data folder:

   ```sh
   EVEN_KEEL_DATA=~/.local/share/even-keel npm run storage -- config-export even-keel.config.json
   ```

   The data folder is `%LOCALAPPDATA%\even-keel` on Windows (in PowerShell, set `$env:EVEN_KEEL_DATA` first) and `~/Library/Application Support/even-keel` on macOS. In a clone installed by itself, run the command without `EVEN_KEEL_DATA`.
3. In the file, change each project's `repo` to its path inside the container: a mounted checkout (see [Data, accounts and repositories](#data-accounts-and-repositories)) or a clone under `/home/node`. If the file sets `backup.dir`, change it the same way or remove it.
4. Create the Compose folder as in [First start](#first-start), but do not start Even Keel yet. The file is read only once, at the first start on an empty volume. Copy the file into the volume from the folder that holds it:

   ```sh
   docker compose run --rm --no-deps -v "$PWD/even-keel.config.json:/import.json:ro" even-keel \
     sh -c 'mkdir -p /home/node/.local/share/even-keel && cp /import.json /home/node/.local/share/even-keel/even-keel.config.json'
   docker compose up -d
   ```

5. On the page, add the tracker profiles in **Settings → Trackers and CI** and choose each project's profile again. Sign in to the agent accounts, then check each project's account.

The volume should then keep the installation. A full move with the database is not available yet.
