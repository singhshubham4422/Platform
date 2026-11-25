# C11 formula notes

All timestamps are parsed as UTC instants and daily rows are grouped by `clientTs`'s UTC date. Duplicate `eventId` values are removed before grouping (smallest `seq` wins); invalid rows missing `userId`, `clientTs`, or `eventType` are ignored.

- Daily active time sorts the user's day by `seq`, sums `min(max(gapSeconds, 0), 120)` for each adjacent pair, skips a gap ending at an `idle_period` (or containing one), divides by 60 and rounds once to one decimal. The normal-day fixture spans four minutes over its six adjacent gaps: 60 + 30 + 30 + 60 + 30 + 30 = 240 seconds, so `active_minutes = 4.0`.
- `questions_attempted` counts distinct question IDs with a `submission_created`; `questions_solved` counts those with any accepted submission. Runs count `execution_completed` in `RUN` mode. Submits and accepted submits count their corresponding submission events.
- `typed_chars` sums `insertedChars`; `paste_chars` sums only `paste_detected` events whose source is `external`. `paste_ratio = paste_chars / (paste_chars + typed_chars)`, or zero for a zero denominator. `idle_minutes` sums `idleMs / 60000`; focus loss is an event count.
- Topic mastery is `round(100 * (solved + 1) / (attempted + 2))`, with attempts/solves counted once per distinct question for each topic. A one-question fully solved topic is `round(100 * 2 / 3) = 67`.
- Assessment score adds points once for every distinct accepted question. Active time uses the same 120-second capped gaps over the assessment stream. Flags use external paste only: `HIGH_PASTE` if ratio > .5 and chars > 200; `FAST_SOLVE` if an accepted submission is under 60 seconds after opening with fewer than 50 typed chars; `MANY_FOCUS_LOSS` if focus losses exceed 20.

For the assessment fixture, external paste is 300 characters and typing is 20, so the ratio is 300/320 = .9375. The accepted answer is 30 seconds after opening with 20 typed characters. It has 21 focus-loss events. Thirty active seconds round to 0.5 minute, and the 20-point question yields score 20. These values trigger all three flags.
