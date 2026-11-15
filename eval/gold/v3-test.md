# Classifier eval: prompt v3, test split

Model: gemini-3.5-flash-lite. Date: 2026-11-15. Postings: 70.

- **Accuracy: 68/70 (97.1%)**
- **Costly error** (citizen/PR-only posting marked as open to me): **0/23** citizen/PR postings missed
- Opposite error (open posting marked citizen/PR-only, so I would skip it): 0
- Consistency: 70/70 (100.0%) postings got the same answer in all 2 runs
- Median latency: 965 ms

## Per category

| category | precision | recall | correct / predicted / actual |
|---|---|---|---|
| citizen_pr | 100.0% | 100.0% | 23 / 23 / 23 |
| portfolio_design | 90.9% | 100.0% | 10 / 11 / 10 |
| waterloo | 100.0% | 94.1% | 16 / 16 / 17 |
| other | 95.0% | 95.0% | 19 / 20 / 20 |

Precision: of the postings the model put in this category, how many really belong there.
Recall: of the postings that really belong in this category, how many the model found.

## Confusion matrix (rows = correct label, columns = model's answer)

| label \ answer | citizen_pr | portfolio_design | waterloo | other | error |
|---|---|---|---|---|---|
| citizen_pr | 23 | 0 | 0 | 0 | 0 |
| portfolio_design | 0 | 10 | 0 | 0 | 0 |
| waterloo | 0 | 0 | 16 | 1 | 0 |
| other | 0 | 1 | 0 | 19 | 0 |

## Misses

| id | label | answer | model's reason |
|---|---|---|---|
| 492630 | waterloo | other | The work location is Toronto, Ontario and the employment arrangement includes hybrid and onsite options. |
| 493035 | other | portfolio_design | The job title is Intern, Strategic Insights (Digital Marketing) under the marketing group. |
