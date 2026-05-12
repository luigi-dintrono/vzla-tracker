# Data

CSV-based data for the three pillars of the Venezuelan Democratic Transition Tracker.

## Convention

Each pillar has two directories:

- `raw/` — unmodified source files as collected (scraper output, manual exports, official downloads). Treat as immutable; never edit by hand. Filename should encode source + date, e.g. `bcv-fx-2026-03-10.csv`.
- `cleaned/` — analysis-ready CSVs derived from `raw/`. One file per metric/series with a stable schema. These are what the dashboard reads.

A short `README.md` in each pillar folder documents the schema, source URLs, and any cleaning steps.

## Pillars

- [pillar-1-press-freedom/](./pillar-1-press-freedom/) — Freedom of the Press Index
- [pillar-2-civic-liberty/](./pillar-2-civic-liberty/) — Protests & Liberty to Organize
- [pillar-3-economy/](./pillar-3-economy/) — Economic Activity & Inflation
