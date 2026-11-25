# Settings by level

The research of BTN-145 (2026-10-18): every setting Even Keel has, the levels it is set at, how they override each other,
and the schema of the settings tables the storage move into one database (BTN-147) builds on. The implementation is
split into BTN-186 (the registry over the current file), BTN-187 (the missing levels) and BTN-146 (effort, the first new
setting on three levels); the "Mismatches" and "Decisions" sections are what they follow.

## Subtopics

The area is split by subtopic, a file each in `docs/settings/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`inventory.md`](settings/inventory.md) | The inventory: every setting, its levels and where it lives |
| [`levels.md`](settings/levels.md) | Levels, mismatches, the proposed schema, reading and writing, credentials, labels as values, decisions |
