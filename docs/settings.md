# Settings by level

Every setting Even Keel has, the levels it is set at and how they override each other, the settings tables of the state
database, the code that reads and writes them, and where credentials are kept.

## Subtopics

The area is split by subtopic, a file each in `docs/settings/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`inventory.md`](settings/inventory.md) | The inventory: every setting, its levels, who writes it, its default; what is outside the settings tables and what is not a setting |
| [`levels.md`](settings/levels.md) | Levels and their order, the schema, reading and writing, tests, credentials, labels as values, decisions |
