# Installing with Docker

The Even Keel image runs on Linux amd64 and arm64. Docker Compose starts the service and its agents as the `node` user (UID 1000). The commands on this page are for a Linux or macOS shell on the Docker host.

## First start

1. Save [compose.yaml](../../compose.yaml) in an empty folder on the Docker host, and run the commands in that folder.
2. Create a private `.env` with a fresh owner key, the key the page asks for:

   ```sh
   (umask 077 && printf 'EVEN_KEEL_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env)
   ```

3. Start Even Keel and watch it come up:

   ```sh
   docker compose up -d
   docker compose logs -f even-keel
   ```

4. Open `http://localhost:4747` on the host, enter the owner key (`EVEN_KEEL_TOKEN` from `.env`) and follow the [setup wizard](setup.md#the-first-start).

Docker manages the service: `even-keel install` inside the container refuses and points to `docker compose up -d`.

The page listens on all interfaces inside the container, and Compose publishes it on the host's loopback address only. For a server or NAS, forward the port through SSH, or put the page behind an HTTPS proxy and enter the proxy's name in **Other names of the page** (**Settings** → **Sign-in and devices**) first ([Reaching the page from another machine](remote.md#reaching-the-page-from-another-machine)).

## Data, accounts and repositories

The named volume `home` holds `/home/node`: the service data in `/home/node/.local/share/even-keel` (database, logs and checked CLIs), the agents' account folders and git's configuration. A repository cloned under `/home/node` survives replacing the container too. Use the same Compose folder and project name each time to reuse the volume: `docker compose down` keeps it, `docker compose down -v` deletes it.

Sign in to the agents' accounts on the page, and enter tracker credentials in **Settings** → **Trackers and CI**.

### A checkout on the host

To use a checkout on the host, add a `compose.override.yaml` beside `compose.yaml` and run `docker compose up -d` again:

```yaml
services:
  even-keel:
    volumes:
      - /srv/even-keel/projects:/projects
```

Mount the whole checkout, with its git folder and worktrees, and give UID 1000 write access. When adding the project, enter the container's path, such as `/projects/demo`. Agents can change the host files mounted there.

### Git author and remotes

- **The author** is set in the setup wizard.
- **SSH remotes:** put a dedicated key and a verified `known_hosts` into a private host folder and mount it read-only at `/home/node/.ssh` (`/srv/even-keel/ssh:/home/node/.ssh:ro`). The key must be readable by UID 1000, with mode 0600.
- **HTTPS remotes on GitHub, GitLab or Forgejo** need no credential file: the forge's profile in **Settings** → **Trackers and CI** is enough ([Token permissions](tracker-several.md#token-permissions)). The token never lands in git's config, a file or a session's environment.
- **Another HTTPS remote**, or one you would rather keep apart, works with a git credential helper of your own. With a credential file mounted read-only at `/run/secrets/git-credentials`, run:

  ```sh
  docker compose exec even-keel git config --global credential.helper 'store --file=/run/secrets/git-credentials'
  ```

Keep keys and credential files on the host, outside the repository and the image. The key in Compose's `.env` opens the Even Keel page: keep it as private.

## The agents' CLIs

The image carries no agent CLI, and none can be installed inside it with `npm install -g`: the container runs as `node`, and npm's global folder belongs to root. So in Docker the page offers no installation command. Pick one of Even Keel's own copies instead, **Checked** or **Latest**, in **Settings** → **Providers and models** → **CLI version** (also in the setup's Agent step and in an agent's window on the accounts page) ([CLI copies](agents.md#cli-copies)). Nothing has to be run in the container. The copies live in the `home` volume and survive an update, roughly 80–340 MB per agent.

- A CLI built into [your own image](#your-own-tools) and set as **Yours** works as well.
- An `EVEN_KEEL_<PROVIDER>_BIN` variable in `compose.yaml` wins over the page's choice, which then does nothing. Remove the variable to go back to the page's choice.

## Your own tools

The image carries Node.js, git, SSH and curl, nothing else a project may need: Python, a compiler, system libraries. They cannot be installed from inside, since the container runs as `node`, without sudo and with `no-new-privileges`. A `docker compose exec -u root even-keel apt-get install …` does work, but only in that container: the next update replaces it, and the tools are gone.

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

The build argument passes the tag from `.env` to the `FROM` line, so a pinned version or `next` holds for your image too. The image gets a name of its own so that `docker compose pull` does not put ours in its place. Build and start it:

```sh
docker compose build --pull && docker compose up -d
```

Tools that install into the home folder, such as mise, uv or rustup, may go into the volume instead of an image, since everything under `/home/node` survives an update. Their folder must be on the service's `PATH` for the agents to find them: `ENV PATH=/home/node/.local/bin:$PATH` in your `Dockerfile`, or the image's whole `PATH` with that folder in front under `environment` in `compose.override.yaml`.

## Updating

The default image tag is `latest`. To follow release candidates, put `EVEN_KEEL_IMAGE_TAG=next` in `.env`; to pin a version, its number without the leading `v`. To update a pinned install, change that number first.

Wait for active sessions to finish, then run the command the page's update window shows, in the Compose folder on the host. With our image:

```sh
docker compose pull && docker compose up -d
```

With [your own image](#your-own-tools) over ours, rebuild it on the new version instead: `pull` would leave it as it is, and the page would keep offering the update.

```sh
docker compose build --pull && docker compose up -d
```

From inside the container the two images look alike, so the window shows both commands. Compose replaces the container and attaches the home volume and the mounted repositories again; the new version updates its database at start by itself.

## Stopping and backing up

Even Keel needs up to 15 seconds to stop. The Compose files give it 30 (`stop_grace_period`) for `docker compose stop`, `down` and the `up -d` of an update; without that setting Docker kills the container after 10 seconds, so a Compose file of your own needs it too.

The [automatic copies](updating.md#backups) of the database lie in the same volume as the database, so losing the volume loses them as well. To keep them elsewhere, mount a host folder UID 1000 can write, such as `/srv/even-keel/backups:/backups`, and set **Settings** → **Backups** → **Copies folder** to `/backups`. Those copies hold the database only; the sign-ins, the machine's own folder and the cloned repositories stay in the volume.

To copy the whole volume, stop the service and pack `/home/node` into an archive in the Compose folder:

```sh
docker compose stop
docker compose run --rm --no-deps --user root -v "$PWD:/backup" even-keel \
  sh -c "tar czf /backup/even-keel-home.tgz -C /home/node . && chmod 600 /backup/even-keel-home.tgz && chown $(id -u):$(id -g) /backup/even-keel-home.tgz"
docker compose start
```

The archive holds the sign-ins, the tracker credentials and the page's settings in the clear: keep it as private as `.env`. To put it back, on a new host or after `down -v`, run in the Compose folder with the archive in it:

```sh
docker compose down
docker compose run --rm --no-deps --user root -v "$PWD:/backup:ro" even-keel \
  sh -c 'find /home/node -mindepth 1 -delete && tar xzpf /backup/even-keel-home.tgz -C /home/node'
docker compose up -d
```

This replaces everything in the volume. For a machine's folder, use the service name `machine` instead of `even-keel`; with `compose.hub-machine.yaml`, copy each service into an archive of its own name.

## Machines

A [machine of a hub](hub-machine.md#a-machine-of-a-hub-preview) runs the hub's tasks and has no page of its own. Either side may be a container:

- **Hub and machines on hosts** — as in [the setup guide](hub-machine.md#a-machine-of-a-hub-preview).
- **Hub in Docker, a machine on a host** — [below](#a-hub-in-docker).
- **A machine in Docker, the hub anywhere** — [below](#a-machine-in-docker).
- **Hub and machine in Docker on one host** — [below](#hub-and-machine-on-one-host).
- **Hub and machines in Docker on several hosts** — the hub's host as a hub in Docker, each machine's host as a machine in Docker.

### A hub in Docker

- **The address.** Inside its container the hub sees only the container's network, so **+ Machine** offers no address of a network card: type the Docker host's name or address.
- **The port.** Compose publishes the machines' port, 4749, on loopback only. For machines on other hosts, add `EVEN_KEEL_MACHINES_PUBLISH=0.0.0.0` (or one of the host's addresses) to `.env` and run `docker compose up -d`, or forward the port through a proxy ([Behind a proxy](hub-machine.md#a-machine-of-a-hub-preview)). Open it only to the network the machines are on.
- **The machine** is installed from npm with the window's command. A machine from a clone cannot follow a hub in an image: its page on the hub tells you to install the hub's version by hand.

### A machine in Docker

1. Save [compose.machine.yaml](../../compose.machine.yaml) as `compose.yaml` in an empty folder on the machine's host.
2. In **+ Machine** on the hub, pick **Docker**. Leave **Machine name** empty to name the machine `even-keel-machine`, the host name the file gives the container, so the name survives a recreated container; type a name, or change `hostname:` before the join, to tell machines on several hosts apart.
3. Run the window's three steps in that folder:

   ```sh
   echo 'EVEN_KEEL_IMAGE_TAG=<the hub version>' > .env
   docker compose run --rm machine even-keel join <the hub's address>
   docker compose up -d
   ```

   The tag is required: a machine runs the hub's version, never `latest`.
4. The join prints a code: compare it with the window **A new machine wants to join** on the hub's page and press **Admit** ([the setup guide](hub-machine.md#a-machine-of-a-hub-preview)). **Or with the connection string** in the window gives the same join with a string instead, which needs no admitting. The join keeps the connection in the volume `machine-home`; a string goes into no file.
5. `docker compose logs -f machine` shows it reach the hub. Started before the join, the `machine` service waits for one instead of starting as a hub.

Then, from the hub's page:

- **The agents' CLIs.** The image carries none, and on **Yours**, the default, the machine has none. A provider on **Checked** downloads its copy on the machine by itself once the hub's own copy is downloaded; until then the pause names the machine — download the copy on the hub, and the machine follows. **Latest** works the same way, except that each machine asks for the newest release itself, so for up to 15 minutes after a release it may run another version than the hub. In the machine's **Add account** window, the tile of an agent with no CLI offers **Use the checked copy**. A provider on **Yours** needs its CLI in an image of your own.
- **The git author.** **Set name and e-mail** on the machine's page (under **On the machine**), or **Commit author** in the project's settings of that machine, opens a window filled with the hub's own.
- **SSH keys** are mounted as for the hub [above](#git-author-and-remotes); accounts are signed in to from the hub's page.

### Hub and machine on one host

1. Use [compose.hub-machine.yaml](../../compose.hub-machine.yaml) as the `compose.yaml` of the hub's folder: the hub keeps its volume `home`, and the machine gets its own. Both services take one `EVEN_KEEL_IMAGE_TAG`.
2. Start the hub, then type `even-keel` as the address in **+ Machine**. The machine reaches the hub by its Compose service name, and the code (or the connection string) checks the hub's certificate, so port 4749 stays closed to other hosts. The window keeps that address for the next machine: for one on another host, type the host's address again.
3. Run the window's join and `docker compose up -d` in the same folder. The hub's host name is `even-keel` in both Compose files, so its own machine is named so as well.

For one more machine on this host, copy the `machine` service under another name with a volume and a `hostname:` of its own, and run the join with that name.

### Updating machines

Every Compose folder has one version, `EVEN_KEEL_IMAGE_TAG` in its `.env`, and a container never updates itself, even when the hub refuses its version.

1. Wait for the sessions of the machines you update to finish: a machine's sessions run inside its container, so `stop`, `down` or the `up -d` of an update ends them. A session cut off this way stays its task's current session, and an answer in the page's chat continues it.
2. Update the hub first: change the number in its `.env` and run `docker compose pull && docker compose up -d` in its folder. With `compose.hub-machine.yaml` this also updates the machine on that host.
3. Then do the same in each other machine's folder. Until then, a machine of another version finishes its tasks and takes no new ones; its page on the hub gives the `.env` line and the commands.

For an image of your own, run `docker compose build --pull && docker compose up -d` instead of `pull`.

## Moving a host installation into Docker

The data folder of an installation on the host cannot be copied into the volume as is: its database stores the host's paths — project checkouts, account folders, task worktrees, the folders of running sessions; on Windows, Windows paths. Only the settings and projects move. Everything else starts afresh in the container:

- tracker profiles and their credentials, the OpenRouter management keys and the agents' sign-ins;
- tasks of a project on the built-in tracker (keep such a project on the host for now);
- the chain's state, the launch log, the statistics and the database copies.

1. Let the chains finish their tasks, then stop Even Keel on the host.
2. Export the settings and projects. The command belongs to a clone of Even Keel, not to the npm package. For an npm installation, clone the same version, run `npm install` in the clone and point it at the installation's data folder:

   ```sh
   EVEN_KEEL_DATA=~/.local/share/even-keel npm run storage -- config-export even-keel.config.json
   ```

   The data folder is `%LOCALAPPDATA%\even-keel` on Windows (in PowerShell, set `$env:EVEN_KEEL_DATA` first) and `~/Library/Application Support/even-keel` on macOS. In a clone installed by itself, run the command without `EVEN_KEEL_DATA`.
3. In the file, change each project's `repo` to its path inside the container: a [mounted checkout](#a-checkout-on-the-host) or a clone under `/home/node`. If the file sets `backup.dir`, change it the same way or remove it.
4. Create the Compose folder as in [First start](#first-start), but do not start Even Keel yet: the file is read only once, at the first start on an empty volume. Copy the file into the volume from the folder that holds it, then start:

   ```sh
   docker compose run --rm --no-deps -v "$PWD/even-keel.config.json:/import.json:ro" even-keel \
     sh -c 'mkdir -p /home/node/.local/share/even-keel && cp /import.json /home/node/.local/share/even-keel/even-keel.config.json'
   docker compose up -d
   ```

5. On the page, add the tracker profiles in **Settings** → **Trackers and CI** and choose each project's profile again. Sign in to the agents' accounts, then check each project's account.

A full move with the database is not available yet.
