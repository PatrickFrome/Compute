# Reject malformed Sentinel action history

Base f48baad8d4a8ecec40fe4b7b0b79a76a74654447.

Five disk-backed regression tests failed before repair: JSON null, false, zero,
empty string, and a record with an unrecognized effect state. Falsy persisted
values were treated as missing journals; an unknown state bypassed both known
termination/relaunch state sets. Either case could lose the existing effect
barrier when the worker restarted.

Only ENOENT now means absent history, and persisted rows must name an existing
state supported by the action journal's actual producers. Failed init never
binds the journal, so subsequent attempted effect intent writes reject. Original
bytes are preserved. Known v1.0/v1.1/v1.2 versions and current transitions remain
supported. No new retry, process termination, or relaunch path is introduced.

Before:7pass5fail. After:53/53 Sentinel/journal/incarnation/worker/recovery tests
passed in isolated Linux profiles. Logs sentinel-history-before.log and
sentinel-history-after.log under windows-lab/evidence. Windows retest pending.

Separate baseline full coverage run on f48:6889tests6778pass29fail82skip,
85.94% line coverage of reported loaded files. One additional installer drain
fixture exited99 against expected0 under coverage; its fixed700ms deadline
requires separate investigation. Do not label this coverage run green or infer
that uncovered code is dead. Ordinary fullrun on f48 remained6779pass28fail.
