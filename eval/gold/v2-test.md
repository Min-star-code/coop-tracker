# Classifier eval: prompt v2, test split

Model: gemini-3.5-flash-lite. Date: 2026-11-15. Postings: 70.

- **Accuracy: 68/70 (97.1%)**
- **Costly error** (citizen/PR-only posting marked as open to me): **2/23** citizen/PR postings missed
- Opposite error (open posting marked citizen/PR-only, so I would skip it): 0
- Consistency: not measured (1 run)
- Median latency: 924 ms

## Per category

| category | precision | recall | correct / predicted / actual |
|---|---|---|---|
| citizen_pr | 100.0% | 91.3% | 21 / 21 / 23 |
| portfolio_design | 100.0% | 100.0% | 10 / 10 / 10 |
| waterloo | 89.5% | 100.0% | 17 / 19 / 17 |
| other | 100.0% | 100.0% | 20 / 20 / 20 |

Precision: of the postings the model put in this category, how many really belong there.
Recall: of the postings that really belong in this category, how many the model found.

## Confusion matrix (rows = correct label, columns = model's answer)

| label \ answer | citizen_pr | portfolio_design | waterloo | other | error |
|---|---|---|---|---|---|
| citizen_pr | 21 | 0 | 2 | 0 | 0 |
| portfolio_design | 0 | 10 | 0 | 0 | 0 |
| waterloo | 0 | 0 | 17 | 0 | 0 |
| other | 0 | 0 | 0 | 20 | 0 |

## Misses

| id | label | answer | model's reason |
|---|---|---|---|
| 491439 | citizen_pr | waterloo | The job city is listed as Waterloo, Ontario. |
| 490871 | citizen_pr | waterloo | Job - City is Waterloo. |
