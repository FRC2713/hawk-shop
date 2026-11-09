# Shop metrics

Every Suite member can open `/metrics` from navigation or the overview. The page reads only local SQLite status history. It makes no Onshape requests.

The date range includes both calendar dates in UTC and defaults to the last 30 days. A completed status visit counts when its exit move falls in the range, even if it began earlier. Ongoing visits are excluded. A visit requires an observed entry followed by an exit from the same status; the first move of a legacy card cannot supply an entry time. Median averages the middle pair for an even sample count; p90 uses the nearest rank.

Cycle time runs from recorded release to the first recorded entry into the last column in the current configuration. Weekly throughput counts that first entry once per card, including cards without a recorded release. A reopened card does not count as a second completion. Completions are selected by their move timestamp and grouped into Monday weeks in UTC. A partial week's count includes only selected dates.

Process breakdowns use current card processes. Cards with several processes contribute to each process but only once to the overall median. Deleted cards and cards without processes use `unknown`.

Backward moves use column indexes recorded at move time and are grouped by the status left. Unknown column indexes do not imply backward movement. Status titles retain their spelling at the time; renamed statuses can appear as separate rows. No pre-upgrade history is inferred and there are no per-member rankings.
