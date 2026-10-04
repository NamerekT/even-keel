# База Tally на сервере

Postgres для статистики сессий: стек `/opt/stacks/tally-stats` на `my-server`, Compose-проект `tally-stats` (закреплён `name:`). Схему создаёт сборщик (BTN-46), здесь — только база, роли и бэкап.

## Что внутри

- `db` — `postgres:18`, порт 5432 опубликован только на адресе tailnet хоста (`BIND_ADDRESS`), в локальной сети его нет.
- Роли (создаёт `initdb/10-roles.sh` при первом старте с пустым томом):
  - `tally_writer` — владелец базы и схемы `public`, пишет сборщик;
  - `tally_reader` — только чтение: `SELECT` на всё, что создаст `tally_writer`, транзакции по умолчанию read-only. Им ходят Even Keel и сессии с недельной сводкой.
  - `postgres` — суперпользователь, нужен только бэкапу и обслуживанию.
- `backup` — раз в `BACKUP_INTERVAL_SECONDS` (по умолчанию сутки) `pg_dump --format=custom --compress=9` в `./backups/tally-<время>.dump`, хранит `BACKUP_KEEP` (по умолчанию 7) последних.

## Установка

С ПК (Git Bash), из корня репозитория:

```sh
ssh my-server 'sudo install -d -o me -g me /opt/stacks/tally-stats'
scp -r tally/deploy/compose.yaml tally/deploy/initdb tally/deploy/scripts my-server:/opt/stacks/tally-stats/
```

На сервере, в `/opt/stacks/tally-stats`:

```sh
umask 077
cat > .env <<EOF
BIND_ADDRESS=$(tailscale ip -4)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
TALLY_DB=tally
TALLY_WRITER_PASSWORD=$(openssl rand -hex 24)
TALLY_READER_PASSWORD=$(openssl rand -hex 24)
EOF
chmod 600 .env
mkdir -p backups && chmod 700 backups
docker compose up -d
```

Пароли ролей переносятся в локальный `.env` Even Keel (вне git) как `TALLY_DB_*`, `TALLY_WRITER_PASSWORD` и `TALLY_READER_PASSWORD` — вид в `.env.example` в корне репозитория.

Порт привязан к адресу tailnet. Чтобы привязка пережила загрузку, на которой Docker стартует раньше `tailscaled`, на сервере стоит `net.ipv4.ip_nonlocal_bind=1` (`/etc/sysctl.d/99-nonlocal-bind.conf`, заведён для LiteLLM). На новом хосте — завести так же.

Каждый старт контейнера `backup` сразу пишет дамп, потом — по расписанию; лишние уходят по `BACKUP_KEEP`.

## Проверка

```sh
export PGUSER=tally_reader PGDATABASE=tally PGPASSWORD=<пароль читателя>
# с ПК по tailnet — должно пройти
psql -h <адрес tailnet> -c 'select current_user'
# с ПК по адресу сервера в локальной сети — соединение должно не установиться
psql -h 192.0.2.10 -c 'select 1'
```

## Восстановление

Проверка последнего дампа во временном контейнере со сверкой числа строк по каждой таблице с живой базой:

```sh
sh scripts/restore-check.sh            # последний дамп
sh scripts/restore-check.sh backups/tally-20261003T000000Z.dump
```

Настоящее восстановление — в пустую базу той же версии: роли из `initdb/10-roles.sh`, затем `pg_restore -U postgres -d tally --exit-on-error < дамп`.
