# Classifier eval: prompt v2, dev split

Model: gemini-3.5-flash-lite. Date: 2026-11-15. Postings: 71.

- **Accuracy: 58/71 (81.7%)**
- **Costly error** (citizen/PR-only posting marked as open to me): **9/23** citizen/PR postings missed
- Opposite error (open posting marked citizen/PR-only, so I would skip it): 0
- Consistency: 70/71 (98.6%) postings got the same answer in all 2 runs
- Median latency: 986 ms

## Per category

| category | precision | recall | correct / predicted / actual |
|---|---|---|---|
| citizen_pr | 100.0% | 60.9% | 14 / 14 / 23 |
| portfolio_design | 80.0% | 72.7% | 8 / 10 / 11 |
| waterloo | 64.0% | 94.1% | 16 / 25 / 17 |
| other | 90.9% | 100.0% | 20 / 22 / 20 |

Precision: of the postings the model put in this category, how many really belong there.
Recall: of the postings that really belong in this category, how many the model found.

## Confusion matrix (rows = correct label, columns = model's answer)

| label \ answer | citizen_pr | portfolio_design | waterloo | other | error |
|---|---|---|---|---|---|
| citizen_pr | 14 | 2 | 7 | 0 | 0 |
| portfolio_design | 0 | 8 | 2 | 1 | 0 |
| waterloo | 0 | 0 | 16 | 1 | 0 |
| other | 0 | 0 | 0 | 20 | 0 |

## Misses

| id | label | answer | model's reason |
|---|---|---|---|
| 493437 | citizen_pr | waterloo | Job - City: Waterloo |
| 490140 | citizen_pr | waterloo | Job - City: Waterloo |
| 492467 | citizen_pr | waterloo | Job - City: Waterloo |
| 491628 | citizen_pr | waterloo | The job location is specified as Waterloo, Ontario. |
| 491443 | citizen_pr | waterloo | The successful candidate will work out of the AccessAbility Services Office, 1401 Needles Hall on the University of Waterloo main campus. |
| 493499 | citizen_pr | portfolio_design | The job title is Marketing Associate and involves creating digital marketing and communications content. |
| 491499 | citizen_pr | portfolio_design | This is a Faculty Content Marketing Associate role involving marketing asset creation and content creation. |
| 489844 | citizen_pr | waterloo | Job - City: Waterloo |
| 490390 | citizen_pr | waterloo | Job - City: Waterloo |
| 490411 | portfolio_design | waterloo | Job - City is Waterloo, Ontario. |
| 491511 | portfolio_design | waterloo | The work location is Waterloo, Ontario. |
| 493194 | portfolio_design | other | The role is based in London, Ontario, with hybrid field work, so it does not meet the Waterloo/remote criteria. |
| 492634 | waterloo | other | The job location is in Toronto and is not restricted to citizens/PR or portfolio design. |

## Inconsistent answers

| id | label | answers |
|---|---|---|
| 490411 | portfolio_design | waterloo, portfolio_design |
