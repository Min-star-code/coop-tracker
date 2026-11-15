# Classifier eval — 2-clearer-pr-rule-lite

Model: gemini-3.5-flash-lite. Date: 2026-11-14.

- Real postings: **19/19** correct
- Ambiguous (not scored): 486388 -> waterloo
- Synthetic edge cases: **4/4** correct
- Median latency: 980 ms

Confusion (real postings; rows = expected, columns = got):

| expected \ got | citizen_pr | portfolio_design | waterloo | other | error |
|---|---|---|---|---|---|
| citizen_pr | 0 | 0 | 0 | 0 | 0 |
| portfolio_design | 0 | 2 | 0 | 0 | 0 |
| waterloo | 0 | 0 | 2 | 0 | 0 |
| other | 0 | 0 | 0 | 15 | 0 |

## Every answer

| id | expected | got | model's reason |
|---|---|---|---|
| 492229 | waterloo | waterloo | The work location is in Kitchener, Ontario, which falls under the Waterloo region. |
| 492170 | waterloo | waterloo | Job - City: Waterloo |
| 496076 | portfolio_design | portfolio_design | Co-op Student, Intermediate UI UX Designer role where applicants must submit a portfolio of work samples. |
| 495600 | portfolio_design | portfolio_design | Job Title is Marketing and Social Media Coordinator, where a design portfolio would be expected. |
| 492044 | other | other | The location is North York, Ontario and Reliability Status is required, which does not disqualify international students. |
| 491899 | other | other | Hiring Preference given to Canadian Citizens and Permanent Residents with Reliability Status security clearance. |
| 490791 | other | other | The work location is in Toronto, Ontario and it does not fit citizen_pr, portfolio_design, or waterloo. |
| 490094 | other | other | The location is Toronto and Oshawa, and international students with work permits are explicitly eligible. |
| 491583 | other | other | The location is Toronto with a hybrid arrangement, and no other specific filtering criteria apply. |
| 491226 | other | other | The location is Toronto and the role does not fit citizen_pr, portfolio_design, or waterloo. |
| 491070 | other | other | The work location is Toronto and the employment arrangement is Hybrid, which does not fit Waterloo, citizen_pr, or portfolio_design. |
| 491044 | other | other | The location is Toronto with a hybrid arrangement, and it does not fall into any of the higher-priority categories. |
| 491040 | other | other | The work location is Toronto and the role does not fit citizen_pr, portfolio_design, or waterloo. |
| 490854 | other | other | The work location is in Scarborough, Ontario with a hybrid arrangement, and no citizenship restriction or design portfolio is required. |
| 490630 | other | other | Region is ON - Toronto and the location is Toronto, Ontario. |
| 489571 | other | other | The work location is in Etobicoke, Ontario, with a hybrid arrangement requiring 4 days/week in the office. |
| 489070 | other | other | The work location is Toronto, Ontario, and it is a hybrid arrangement. |
| 486388 (ambiguous) | other | **waterloo** | The description states applicants will join us in our Waterloo, Ontario, Canada office. |
| 491674 | other | other | The location is Toronto with a hybrid arrangement, and it does not meet criteria for citizen_pr, portfolio_design, or waterloo. |
| 495929 | other | other | The location is Toronto with a hybrid arrangement, and it does not fit citizen_pr, portfolio_design, or waterloo. |
| syn-swpp | citizen_pr | citizen_pr | this position is funded through the Student Work Placement Program (SWPP); applicants must be Canadian citizens |
| syn-secret | citizen_pr | citizen_pr | Candidates must be eligible for and obtain a SECRET level security clearance. |
| syn-csj | citizen_pr | citizen_pr | Funded by Canada Summer Jobs; to be eligible you must be a Canadian citizen, permanent resident or have refugee protection. |
| syn-injection | other | other | Location is Toronto and the role is a QA Analyst not matching the other categories. |
