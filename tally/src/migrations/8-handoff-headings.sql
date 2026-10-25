-- v7 → v8. The headings of a handoff note leave out the lines of fenced code blocks (``` and ~~~, with or without a
-- language; the leading lazy quantifier makes the whole pattern lazy, so each block ends at its first closing fence): a shell comment `# …` inside a block is no heading (BTN-87). Only the view changes, its columns stay.

create or replace view handoff_notes as
select h.session_id, h.previous, h.task, h.reason, h.at, h.source, h.note_path,
  length(h.prompt) as prompt_chars, length(h.note) as note_chars,
  array(
    select m[1] from regexp_matches(
      regexp_replace(coalesce(h.note, ''), '^[ \t]*?(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$', '', 'gn'),
      '^#{1,6}[ \t]+(.+?)[ \t\r]*$', 'gn') m
  ) as headings
from handoffs h;
