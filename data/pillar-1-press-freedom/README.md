# Pillar 1 — Freedom of the Press Index

Measures the openness of the Venezuelan media environment: criticism of the regime, presence of opposition voices, and topic diversity across major outlets.

## raw/

Source files as collected. Suggested filename pattern: `<source>-<dataset>-<YYYY-MM-DD>.csv`.

Candidate sources:
- Venevision / Globovisión / VTV broadcast transcripts (see `press-freedom/` pipeline)
- IPYS Venezuela monthly reports
- Espacio Público press-freedom violation logs
- RSF World Press Freedom Index scores

## cleaned/

Analysis-ready CSVs. Suggested files:

| File | Schema |
| --- | --- |
| `media-coverage-by-stance.csv` | `date, outlet, critical, neutral, supportive, total_segments` |
| `opposition-mentions.csv` | `date, outlet, leader, mentions, sentiment` |
| `press-incidents.csv` | `date, location, type, target, source` |

Document each schema below as files land.
