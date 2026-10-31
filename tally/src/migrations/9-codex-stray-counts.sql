-- v8 → v9. A Codex response is its token_usage_record once the CLI writes them: a turn stopped between a record and its
-- token_count shifted every later token_count off the records' totals, and each was written again as `codex:<session>:<total>`
-- (BTN-626). Drop such rows from the session's first record on; the token_count rows before it (an older CLI, the session
-- resumed by a newer one) stay. Records are the session's rows not keyed `codex:`.

delete from messages c
using (
  select session_id, min(at) as first_at
  from messages
  where entrypoint like 'codex%' and message_id not like 'codex:%'
  group by session_id
) r
where c.session_id = r.session_id
  and c.message_id like 'codex:%'
  and c.at >= r.first_at;
