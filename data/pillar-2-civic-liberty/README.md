# Pillar 2 — Protests & Liberty to Organize

Measures freedom of assembly and the right to organize: protest counts, government response, political prisoners, and restrictions on civic activity.

## raw/

Source files as collected. Suggested filename pattern: `<source>-<dataset>-<YYYY-MM-DD>.csv`.

Candidate sources:
- OVCS (Observatorio Venezolano de Conflictividad Social) monthly bulletins
- Foro Penal political prisoner counts
- ACLED protest event data (Venezuela filter)
- Provea human rights reports

## cleaned/

Analysis-ready CSVs. Suggested files:

| File | Schema |
| --- | --- |
| `protests-monthly.csv` | `date, state, category, count, repression_count` |
| `political-prisoners.csv` | `date, total, by_category (json or wide columns)` |
| `civic-restrictions.csv` | `date, type, description, source` |

Document each schema below as files land.
