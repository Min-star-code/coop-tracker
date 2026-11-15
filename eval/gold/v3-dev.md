# Classifier eval: prompt v3, dev split

Model: gemini-3.5-flash-lite. Date: 2026-11-15. Postings: 71.

- **Accuracy: 71/71 (100.0%)**
- **Costly error** (citizen/PR-only posting marked as open to me): **0/23** citizen/PR postings missed
- Opposite error (open posting marked citizen/PR-only, so I would skip it): 0
- Consistency: not measured (1 run)
- Median latency: 1004 ms

## Per category

| category | precision | recall | correct / predicted / actual |
|---|---|---|---|
| citizen_pr | 100.0% | 100.0% | 23 / 23 / 23 |
| portfolio_design | 100.0% | 100.0% | 11 / 11 / 11 |
| waterloo | 100.0% | 100.0% | 17 / 17 / 17 |
| other | 100.0% | 100.0% | 20 / 20 / 20 |

Precision: of the postings the model put in this category, how many really belong there.
Recall: of the postings that really belong in this category, how many the model found.

## Confusion matrix (rows = correct label, columns = model's answer)

| label \ answer | citizen_pr | portfolio_design | waterloo | other | error |
|---|---|---|---|---|---|
| citizen_pr | 23 | 0 | 0 | 0 | 0 |
| portfolio_design | 0 | 11 | 0 | 0 | 0 |
| waterloo | 0 | 0 | 17 | 0 | 0 |
| other | 0 | 0 | 0 | 20 | 0 |

## Misses

| id | label | answer | model's reason |
|---|---|---|---|
