# Classifier eval — 1-baseline

Model: gemini-3.5-flash. Date: 2026-11-14.

- Real postings: **13/20** correct
- Synthetic edge cases: **3/4** correct
- Median latency: 2900 ms

Confusion (real postings; rows = expected, columns = got):

| expected \ got | citizen_pr | portfolio_design | waterloo | other | error |
|---|---|---|---|---|---|
| citizen_pr | 0 | 0 | 0 | 0 | 0 |
| portfolio_design | 1 | 1 | 0 | 0 | 0 |
| waterloo | 0 | 0 | 2 | 0 | 0 |
| other | 5 | 0 | 1 | 10 | 0 |

## Every answer

| id | expected | got | model's reason |
|---|---|---|---|
| 492229 | waterloo | waterloo | The job location is Kitchener, Ontario, which is part of the Waterloo Region. |
| 492170 | waterloo | waterloo | The job is located in Waterloo, Ontario at 200 University Avenue West. |
| 496076 | portfolio_design | **citizen_pr** | The posting specifies "Security Clearance Required" under Additional Information. |
| 495600 | portfolio_design | portfolio_design | The position is for a Marketing and Social Media Coordinator focusing on content creation, social media management, and graphic design assets. |
| 492044 | other | **citizen_pr** | The job requires a Security Clearance and asks candidates to provide proof of Canadian citizenship. |
| 491899 | other | **citizen_pr** | Security clearance is required to obtain Reliability Status for this role with Defence Research and Development Canada. |
| 490791 | other | other | The position is an in-person Research Analyst role located in Toronto, Ontario. |
| 490094 | other | other | The position is an in-person role located in Toronto/Oshawa and is open to international students on work permits. |
| 491583 | other | other | The position is located in Toronto under a hybrid work arrangement. |
| 491226 | other | **citizen_pr** | The posting states that a Security Clearance is required. |
| 491070 | other | other | The position is located in Toronto (Hybrid) and does not require Canadian citizenship, a design portfolio, or a Waterloo-area location. |
| 491044 | other | **citizen_pr** | The posting states 'Security Clearance Required' under Additional Information. |
| 491040 | other | other | The position is located in Toronto, Ontario (In-person) and does not meet the criteria for citizenship, portfolio design, or Waterloo region. |
| 490854 | other | other | The position is a hybrid role based in Scarborough, Ontario. |
| 490630 | other | other | The job is located in Toronto with an in-person work arrangement and does not meet the criteria for citizenship, portfolio design, or Waterloo location. |
| 489571 | other | other | The job is located in Etobicoke, Ontario (Hybrid), does not require Canadian citizenship or permanent residency, and is not a design role. |
| 489070 | other | other | The role is a hybrid Business Analyst internship based in Toronto and does not fall under citizen/PR requirements, design portfolio roles, or the Waterloo region. |
| 486388 | other | **waterloo** | The posting states: "We are currently looking for a highly motivated student to join us in our Waterloo, Ontario, Canada office". |
| 491674 | other | other | The job is a hybrid role located in Toronto and does not specify Canadian citizenship/PR requirements or fall under portfolio design or Waterloo/remote location. |
| 495929 | other | **citizen_pr** | The job posting states 'Security Clearance Required' under Additional Information. |
| syn-swpp | citizen_pr | **error** | Gemini quota reached, try again in a minute |
| syn-secret | citizen_pr | citizen_pr | Candidates must be eligible for and obtain a SECRET level security clearance. |
| syn-csj | citizen_pr | citizen_pr | The posting states it is funded by Canada Summer Jobs and requires candidates to be a Canadian citizen, permanent resident, or have refugee protection. |
| syn-injection | other | other | The job is an in-person QA Analyst role located in Toronto. |
