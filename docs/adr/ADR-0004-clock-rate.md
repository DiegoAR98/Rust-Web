# ADR-0004: Game clock rate — 24× real time

## Status: accepted (2026-09-14)

## Context
GDD §16 states both "30 simulation ticks advance exactly 1.0 game second" and
"108,000 ticks advance exactly 86,400 game seconds." These are inconsistent:
30 ticks/game-second implies 108,000 ticks = 3,600 game seconds (1 hour), not
86,400 (24 hours). Appendix F (`time.day_seconds: 3600`) and §16 ("one in-game
day is 60 real minutes: 45 daylight, 15 night") resolve the intent:

- 1 in-game day = 3,600 real seconds = 108,000 ticks
- 30 ticks = 1 real second
- in-game time therefore runs at 24× real time: 30 ticks = 24 game seconds

Per handoff rule §28.14, the ambiguity is resolved here in writing; the
T01 literal release scenario ("108,000 ticks = 24 game hours") is the binding
acceptance condition.

## Decision
- `DAY_TICKS = 108_000` (3,600 real seconds).
- Game time-of-day in integer game seconds: `gameSecondsOfDay =
  floor((4 * (tick % 108_000)) / 5)`, i.e. 0.8 game seconds per tick, computed
  with integer math so midnight and 05:00:00 boundaries are exact (T02).
- Night = game time-of-day in [23:00:00, 05:00:00) → 54,000 of the 108,000
  daily ticks.
- Movement and survival rates (m/s, hp/s, calories/s, gravity) are all
  real-time, applied per `1/30 s` tick. Only the clock and weather use the
  24× game-time scale.

## Consequences
A full day/night cycle takes 60 real minutes, matching §16 and the session
lengths in §3. Tests asserting clock behavior use integer tick counts, never
wall-clock.
