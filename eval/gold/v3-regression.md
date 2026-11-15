# Classifier eval: prompt v3, regression split

Model: gemini-3.5-flash-lite. Date: 2026-11-15. Postings: 20.

- **Accuracy: 20/20 (100.0%)**
- **Costly error** (citizen/PR-only posting marked as open to me): **0/6** citizen/PR postings missed
- Opposite error (open posting marked citizen/PR-only, so I would skip it): 0
- Consistency: not measured (1 run)
- Median latency: 939 ms

## Per category

| category | precision | recall | correct / predicted / actual |
|---|---|---|---|
| citizen_pr | 100.0% | 100.0% | 6 / 6 / 6 |
| portfolio_design | 100.0% | 100.0% | 4 / 4 / 4 |
| waterloo | 100.0% | 100.0% | 5 / 5 / 5 |
| other | 100.0% | 100.0% | 5 / 5 / 5 |

Precision: of the postings the model put in this category, how many really belong there.
Recall: of the postings that really belong in this category, how many the model found.

## Confusion matrix (rows = correct label, columns = model's answer)

| label \ answer | citizen_pr | portfolio_design | waterloo | other | error |
|---|---|---|---|---|---|
| citizen_pr | 6 | 0 | 0 | 0 | 0 |
| portfolio_design | 0 | 4 | 0 | 0 | 0 |
| waterloo | 0 | 0 | 5 | 0 | 0 |
| other | 0 | 0 | 0 | 5 | 0 |

## Misses

| id | label | answer | model's reason |
|---|---|---|---|
