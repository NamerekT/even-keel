# Tally

Сборщик статистики сессий Claude Code (BTN-44): дочитывает транскрипты всех сессий со всех аккаунтов и складывает их в Postgres на `my-server` (`tally/deploy`, BTN-45). Батон и сводки потом только читают базу ролью `tally_reader`.

Правила корневого `CLAUDE.md` действуют. Ниже — только своё.

## Запуск

- Один прогон — `npm run tally` (или `node --import tsx tally/src/main.ts`) из корня репозитория: дочитать новое, записать снимок лимитов, пересчитать признаки изменившихся сессий, спросить у Huly устаревшие задачи, классифицировать до `classify.perRun` отрезков, выйти. Код выхода 1 — хоть один файл не загрузился (ошибки в выводе), остальное записано.
- Доступ — из корневого `.env`: `TALLY_DB_HOST`, `TALLY_DB_PORT`, `TALLY_DB_NAME`, `TALLY_WRITER_PASSWORD` (роль `tally_writer`, `TALLY_WRITER_USER` — чтобы сменить имя). Конфиг без секретов — `tally/tally.config.json` (`TALLY_CONFIG` — другой путь).
- Журнал запусков Батона — `state/launches.jsonl` (`BATON_STATE_DIR`), папки аккаунтов — `AccountHomes` Батона (`CLAUDE_CONFIG_DIR`, `BATON_ACCOUNTS_DIR`). Из worktree: `BATON_STATE_DIR=<основной чекаут>/state node --env-file=<основной чекаут>/.env --import tsx tally/src/main.ts`.
- Планировщик: `tally/scheduler/install.ps1` из PowerShell 7 от администратора — задача «Tally collector» раз в 5 мин (`-Minutes`), от текущего пользователя с входом S4U: идёт и без входа в систему, без окна, пароль не хранится (инвариант 4). Вывод — `logs/tally.log`. Второй экземпляр, пока идёт первый, не стартует (и планировщик, и `pg_try_advisory_lock` в базе). `uninstall.ps1` снимает задачу, база остаётся.
- `claude -p /usage` сборщик не запускает никогда: лимиты он берёт у Батона (см. ниже), лишний опрос даёт 429 на общем токене.

## Что читается

- Все `*.jsonl` в `<папка аккаунта>/projects/<проект>/` и транскрипты субагентов `<проект>/<сессия>/subagents/agent-*.jsonl` (их `sessionId` — родительская сессия, `agentId` — свой; стоимость субагентов входит в задачу). Прочее в папках сессий (`tool-results/`, `memory/`) не читается.
- Дозагрузка (`src/load.ts`): по файлу в `files` — докуда прочитано (`read_to`, байт после последнего `\n`), размер, `mtime`, `ino` и SHA-1 первых ≤1 КБ. Файл не менялся — не открывается. Вырос — читается хвост кусками по 8 МБ (строка длиннее куска — кусок растёт), каждый кусок — одна транзакция вместе с новым `read_to`, так что упавший прогон продолжается с того же места. Недописанная последняя строка ждёт следующего прогона. Файл стал меньше `read_to`, сменил `ino` или начало — читается заново с нуля; переименованный — новый путь, читается целиком. Дублей нет: ключи — `uuid` строки, `message.id` ответа, `tool_use_id`. Пропавшие пути из `files` удаляются.

## Схема (`src/schema.sql`, создаётся на каждом прогоне, `if not exists` / `create or replace view`)

- `lines` — строки с `uuid`: сессия, агент, тип, время и сжатая сырая строка `raw jsonb`. Служебные строки без `uuid` (`ai-title`, `custom-title`, `queue-operation`, `file-history-*` …) не хранятся, из них берутся только заголовки сессий.
- `messages` — один ответ API (`message.id`): CLI пишет ответ несколькими строками `assistant` по блоку на строку с повтором `usage`, итоговый `output_tokens` — в последней; при слиянии по каждому виду токенов берётся больший, время — меньшее. Колонки: сессия, агент, аккаунт (папка аккаунта файла), проект и его папка (`cwd` без хвоста `.claude/worktrees/…`), задача, ветка, `entrypoint`, модель, `speed`, токены `input`, `cache_write_5m`, `cache_write_1h`, `cache_read`, `output`. Запись кэша без разбивки `cache_creation` считается 5-минутной. Ответы `<synthetic>` и `isApiErrorMessage` — не ответы API, в `messages` не идут.
- `tool_calls` — вызов (`tool_use`: имя, SHA-1 входа для поиска повторов, краткое описание как в ленте Батона) и его результат (`tool_result`: время, `is_error`, вид ошибки, первые 500 знаков текста). Вид: `denied` — отказ в разрешении (пользователь или классификатор авто-режима), `hook` — `PreToolUse:…`/`PostToolUse:… hook error`, `error` — остальное. Вызов и результат пишут разные колонки одной строки, порядок загрузки не важен.
- `sessions` — аккаунт, проект, заголовки `custom_title` (поставил пользователь) и `ai_title`, задача и причина из журнала запусков Батона, первая и последняя строка.
- `limit_snapshots` — снимки окон `5h`/`7d` по аккаунту: процент, сброс, источник, время снимка.
- `model_prices` — цены из `tally.config.json`, переписываются на каждом прогоне.
- `files` — состояние дозагрузки.
- `signs`, `spans`, `sign_sessions` — признаки, отрезки и с какими правилами и до какой строки посчитана сессия; `span_reasons` — причина отрезка от классификатора; `tasks` — задачи из Huly (ниже).
- Views: `session_tasks` — задача сессии (`launch_task`, иначе задача первого ответа с задачей); `stuck_spans` — отрезки с задачей и причиной; `task_repeats` — по задаче: сессии, передачи дел по видам (`relay`, `checkpoint`, `restart`), отрезки, заголовок, статус, ярлыки, `rework` (есть ярлык `Переделка`), связанные задачи.

Задача ответа: запуск сессии в журнале Батона (`state/launches.jsonl`, кроме `postpone`/`skip`) → ветка `<ключ>-<номер>/…` → папка `.claude/worktrees/<ключ>-<номер>`. Журнал применяется и задним числом (`sessions.launch_task`, view берёт его первым).

## Сжатие сырых строк

Замер 2026-10-03: 753 файла, 280 тыс. строк, 1166 МБ. Из них `toolUseResult` — 321 МБ (копия блока `tool_result`), блоки `tool_result` — 274 МБ, вложения — 196 МБ, подписи thinking — 70 МБ (текст thinking пустой), картинки — 40 МБ. Выбрано (`src/compact.ts`):

- `toolUseResult`, `wireToolInputs` и `rendered` верхнего уровня выбрасываются — это копии того, что уже есть в `message`;
- `signature` и `data` картинки (`source.type = base64`) заменяются длиной;
- любая строка длиннее 2000 знаков — первые 2000 и `…[+N]`;
- `\u0000` и одиночные суррогаты убираются — их не принимает `jsonb`.

После первой загрузки (754 файла, 281 тыс. строк, 56 с; повторный запуск дочитывает только хвосты, доли секунды) база — 405 МБ: `lines` — 354 МБ, `tool_calls` — 28 МБ, `messages` — 15 МБ. Та загрузка выбрасывала только `toolUseResult`; `wireToolInputs` и `rendered` в ней занимают 40 МБ, без них база около 365 МБ. Внутри `lines.raw` больше всего весят вложения (88 МБ, из них `prompt_snapshot` — 52 МБ) и `message.usage` (48 МБ, оставлен: из него пересчитываются токены, если разбор поменяется).

## Стоимость

`message_costs` — `messages` × цена модели по самому длинному совпавшему префиксу (`claude-opus-5-5` раньше `claude-opus-5`), за миллион токенов: вход, выход, чтение кэша, запись кэша на 5 мин и на 1 ч по своим ценам. Цены — в view, а не в строках: правка `tally.config.json` пересчитывает и историю. Модель без цены — `cost` пустой, прогон пишет её в лог. Цены — API Anthropic на 2026-09-25 (запись 5 мин = 1,25× входа, 1 ч = 2×). Быстрый режим (`speed = fast`, у Opus дороже) в данных не встречался: `speed` хранится, цена его не учитывает.

`task_costs` — по задаче: ответы, сессии, токены, стоимость, доли лимитов.

Сверка 2026-10-03: независимый подсчёт по транскриптам (по `message.id` — максимум токенов, 5 мин / 1 ч из `usage.cache_creation`, цены из `tally.config.json`) совпал с `task_costs.cost` до последнего знака у BTN-45 (одна сессия, $2.52) и BTN-37 (сессия и субагент, две модели, $1.20).

## Доля лимита

Лимиты — из Батона: `GET <batonUrl>/api/state` (`BATON_URL` поверх конфига), `account.accounts[].limits` — там и statusline, и опрос `/usage`, по каждому аккаунту. Батон не отвечает — `state/rate-limits.json` (только statusline, аккаунт по `configDir`). Снимок с тем же временем не дублируется.

`limit_intervals`: соседние снимки окна одного аккаунта дают интервал и прирост процента. Сброс тот же (±30 мин — источники округляют по-разному) — прирост `max(0, текущий − прошлый)`; окно сменилось — прирост равен текущему проценту, а интервал начинается не раньше начала нового окна (`сброс − 5 ч` / `− 7 дней`). Первый снимок окна интервала не даёт. `limit_shares`: прирост интервала делится между ответами этого аккаунта в интервале пропорционально их стоимости по ценам API. Это оценка: процент целый, снимки раз в несколько минут, к аккаунту `global` десктопное приложение примешивает свой вход.

## Признаки (`src/signs.ts`)

Где сессия топталась на месте — без LLM, по строкам из `lines`. Поток — основная сессия и каждый субагент отдельно (`src/stream.ts`). Виды:

- `failures` — `failureRun` (3) упавших вызовов подряд; `denied` — `deniedRun` (1) отказов в разрешении подряд;
- `repeat` — одна команда (`Bash` и др. — по тексту команды без лишних пробелов) `repeatRun` (2) раз без правки между ними (`Edit`, `Write`, `MultiEdit`, `NotebookEdit` сбрасывают счёт);
- `reread` — один файл прочитан `Read` `rereadCount` (5) раз за поток (путь без регистра и с `/`);
- `no_commit` — `noCommitReplies` (150) ответов основной сессии подряд без успешного `git commit`;
- `rewind` — у одного родителя несколько промтов пользователя (`/rewind` или правка сообщения);
- `compact` — сжатие контекста, `handoff` — сессия запущена передачей дел (`relay`/`checkpoint`/`restart` из журнала Батона). Эти две — метки: сами отрезка не дают, только дописываются в отрезок, куда попали.

Признаки одного потока, пересекающиеся по времени, сливаются в отрезок (`spans`, id — SHA-1 сессии, агента и крайних `uuid`). Сессия пересчитывается, когда у неё новая последняя строка или сменился ключ — SHA-1 версии признаков (`SIGNS_VERSION`), правил и причины запуска.

Правила — `signs` в `tally.config.json` поверх умолчаний, целые ≥ 1. Калибровка 2026-10-03 по всем сессиям: без коммита p95 — 102 ответа, порог 150; перечитанных ≥ 5 раз файлов — 18; серий из ≥ 3 упавших — 16; отказов — 40; повторов ≥ 2 — 15; `/rewind` в данных не было.

## Задачи из Huly (`src/huly.ts`)

Свой небольшой клиент (`HulyTask` Батона без связей, его модель не трогается): по идентификаторам задач из `session_tasks` — заголовок, статус, ярлыки (без дублей без учёта регистра) и связи `relations`, сделанные симметричными; связанные задачи вне выборки — вторым запросом по id. Задача спрашивается, если её нет в `tasks` или запись старше часа; не найденная в Huly пишется с пустым заголовком, чтобы не спрашивать каждый прогон. Huly недоступен — строка в лог, прогон идёт дальше. Шум api-client «no document found, failed to apply model transaction» на подключении отфильтрован.

Задачу Huly узнаёт только после первой её сессии: задача без сессий в `task_repeats` не попадает.

## Классификатор (`src/classify.ts`, `src/steps.ts`)

Причина отрезка — от Haiku на подписке, без ключа API: `claude -p --model haiku --output-format json --no-session-persistence --tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands --system-prompt …`, промт — через stdin (не аргументом: из Git Bash слэш-аргумент становится платным ходом), `cwd` — пустая временная папка, аккаунт — активный аккаунт Батона (`state/account.json`). В промте — задача, признаки отрезка и выдержка: события отрезка и последний промт перед ним, длиннее 120 событий — первые 40, «… N events skipped …», последние 80. Ответ CLI ждётся до 3 мин. Причины: `unclear_task`, `broken_tooling`, `debug_loop`, `waiting_user`, `limit_env`, `normal`, `other`, пояснение — по-русски.

- Берутся отрезки сессий, молчащих `classify.idleMinutes` (60) и активных не раньше `classify.sinceDays` (14) дней, свежие первыми, не больше `classify.perRun` (10) за прогон; `perRun: 0` выключает.
- Отрезок с причиной не классифицируется повторно; `prompt_version` (`PROMPT_VERSION`) хранится с причиной.
- CLI упал — строка в лог, классификатор стоит до следующего прогона. Ответ не разобран — причина `other` с текстом ответа в пояснении.
- Расход — строкой в `messages` (`message_id` `tally-classify:<сессия>:<модель>`, проект `tally`, `entrypoint` `tally-classify`, запись кэша как 5-минутная), в одной транзакции с причиной: он в `message_costs`, как любой другой.
- Замер 2026-10-03: ~19 с на отрезок, $0.004–0.01 (в среднем $0.0099 на 11 отрезков).

## Недельная сводка

На просьбу «недельный аудит» сессия берёт готовые цифры из базы и пишет короткую сводку. Только чтение: роль `tally_reader` (`TALLY_READER_PASSWORD`, `TALLY_READER_USER` — чтобы сменить имя), никаких `insert`/`update`, сборщик не запускается. Из worktree: `node --env-file=<основной чекаут>/.env` и скрипт в `.temp/` на `pg` (клиент — как в `src/stats/reader.ts`).

Неделя — последние 7 суток от `now()`, прошлая — 7 суток перед ней. Проект ответа — префикс задачи (`CBL-…` → `CBL`), без задачи — `(папка)` из `messages.project`: это папка `cwd`, у служебных сессий бывают подпапки и пробные каталоги, мелочь (< $5 за неделю) сводится в «прочее».

```sql
-- 1. Расход по проектам: неделя, прошлая, сессии, ответы без цены
select coalesce(split_part(task, '-', 1), '(' || coalesce(project, '?') || ')') as project,
  round(sum(cost) filter (where at >= now() - interval '7 days'), 2) as week,
  round(sum(cost) filter (where at <  now() - interval '7 days'), 2) as prev,
  count(distinct session_id) filter (where at >= now() - interval '7 days') as sessions,
  count(*) filter (where cost is null and at >= now() - interval '7 days') as unpriced
from message_costs where at >= now() - interval '14 days'
group by 1 order by week desc nulls last;

-- 2. Цепочка Батона против остального (sessions.launch_reason не пуст — сессия из журнала запусков)
select case when s.launch_reason is not null then 'цепочка' else 'вне цепочки' end as scope,
  round(sum(m.cost) filter (where m.at >= now() - interval '7 days'), 2) as week,
  round(sum(m.cost) filter (where m.at <  now() - interval '7 days'), 2) as prev
from message_costs m join sessions s using (session_id)
where m.at >= now() - interval '14 days' group by 1;

-- 3. Самые дорогие задачи недели
select m.task, round(sum(m.cost), 2) as cost, count(distinct m.session_id) as sessions, t.status, t.title
from message_costs m left join tasks t using (task)
where m.at >= now() - interval '7 days' and m.task is not null
group by m.task, t.status, t.title order by cost desc limit 10;

-- 4. Повторы: задачи с ответами за неделю и больше чем одной сессией, переделкой или отрезками (счётчики — за всё время задачи)
select r.task, r.sessions, r.relays, r.checkpoints, r.restarts, r.spans, r.rework, r.status, r.title
from task_repeats r
where exists (select 1 from message_costs m where m.task = r.task and m.at >= now() - interval '7 days')
  and (r.sessions > 1 or r.rework or r.spans > 0)
order by r.sessions + r.spans desc limit 10;

-- 5. Застревания: причины недели и прошлой, виды признаков, разобранные отрезки с пояснением
select coalesce(reason, '(не разобрано)') as reason,
  count(*) filter (where to_at >= now() - interval '7 days') as week,
  count(*) filter (where to_at <  now() - interval '7 days') as prev
from stuck_spans where to_at >= now() - interval '14 days' group by 1 order by week desc;
select k as kind, count(*) as spans, count(*) filter (where reason is null) as unclassified
from stuck_spans, unnest(kinds) k where to_at >= now() - interval '7 days' group by 1 order by 2 desc;
select task, from_at, kinds, reason, note from stuck_spans
where to_at >= now() - interval '7 days' and reason is not null and reason <> 'normal' order by from_at desc limit 15;

-- 6. Доля лимита по проектам, в процентных пунктах окна (оценка, только где были снимки)
select coalesce(split_part(s.task, '-', 1), '(без задачи)') as project, l.span,
  round(sum(l.share)::numeric, 1) as pp, min(l.since) as since
from limit_shares l left join session_tasks s using (session_id)
where l.till >= now() - interval '7 days' group by 1, 2 order by 1, 2;
```

Сводка — по-русски, коротко, цифры с округлением до доллара (у задач — до цента):

1. **Итог** — неделя против прошлой в долларах по ценам API и в процентах; цепочка против остального.
2. **Проекты** — строка на проект: неделя, прошлая, изменение, сессии.
3. **Дорогие задачи** — до 5: задача, заголовок, деньги, сессии.
4. **Повторы** — задачи с передачами дел, заменами и переделкой: сколько сессий и почему (лимит, контрольная точка, замена вручную).
5. **Застревания** — сколько отрезков, по причинам; 2–3 разобранных примера с пояснением классификатора; сколько не разобрано и каких видов.
6. **Лимит** — доля по проектам, если снимки покрывают неделю; иначе — с какого момента они есть.
7. **Выводы** — 2–4 пункта: что изменилось и что из этого стоит поправить (правило, навык, разрешение, формулировка задачи). Только то, что видно в цифрах.

Цены — оценка по API, не счёт подписки; задачи в `tasks` обновляются раз в час, статус может отставать.

## Тесты

Чистая логика — vitest рядом с кодом (`*.test.ts`): разбор строк, сжатие, задача по ветке и worktree, дозагрузка хвоста (на временном файле и хранилище в памяти), снимки лимитов, конфиг, признаки и отрезки на синтетических транскриптах, выдержка и разбор ответа классификатора, задачи Huly. SQL (стоимость, доля лимита, `task_repeats`) и вызов `claude -p` проверяются живым прогоном.
