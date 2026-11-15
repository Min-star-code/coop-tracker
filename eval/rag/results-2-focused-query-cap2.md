# RAG tailoring helper: eval (2-focused-query-cap2)

Models: gemini-embedding-001 (embeddings, 768 dims), gemini-3.5-flash-lite (generation). k = 8. Date: 2026-11-15. Postings: 8. Index: 394 chunks.

## Retrieval (labels: which of my projects / paragraphs should come back)

- **Hit rate@8: 8/8 (100.0%)** postings got at least one expected source in the top 8
- **Recall@8: 70.1%** of expected sources retrieved, averaged over postings

## Faithfulness (generation)

- Picks shown: 35; picks the guard dropped: **0** (cited an unretrieved excerpt or a number not in the excerpt/posting)
- "Requirement" phrases not found word for word in the posting (kept, flagged): 0/35
- Picks that are an expected source: 21/35
- Every shown suggestion is the stored text of a retrieved chunk, so a suggestion cannot contain a claim
  that is not in my own material; only the one-line "why" is model-written, and it is checked for numbers.

| posting | kind | expected found | picks | dropped | picked sources |
|---|---|---|---|---|---|
| 492696 | QA automation | 5/5 | 4 | 0 | B2 Memory Map; B1 LeetReview; B3 Memo Clock; Co-op Tracker: Full-Stack Job-Search Tracker |
| 493445 | software test | 4/5 | 4 | 0 | B1 LeetReview; Co-op Tracker: Full-Stack Job-Search Tracker; Memory Map (Prototype): Step-by-Step C Memory Visualizer; Algorithmic Logic & Programming Coursework |
| 493315 | web developer | 3/5 | 3 | 0 | Memory Map (Prototype): Step-by-Step C Memory Visualizer; C1 Toronto; GA4 E-commerce Funnel Analysis |
| 493134 | data analyst | 6/7 | 6 | 0 | TTC Subway Delay Incident Analysis; Ontario Infrastructure Projects Dashboard & Briefing Note; Toronto Healthcare Outbreak Data Quality & Reporting; C1 Toronto; AdventureWorks Sales & Profitability Analysis; Ontario Labour Market Analysis: LFS & Job Vacancies |
| 492619 | UX design | 1/4 | 4 | 0 | Memory Map (Prototype): Step-by-Step C Memory Visualizer; Memo Clock (team project); Co-op Tracker: Full-Stack Job-Search Tracker; GA4 E-commerce Funnel Analysis |
| 492994 | project coordinator | 3/5 | 4 | 0 | C1 Toronto; Ontario Infrastructure Projects Dashboard & Briefing Note; Class President; Co-op Tracker: Full-Stack Job-Search Tracker |
| 492837 | AI engineering | 3/3 | 4 | 0 | LeetReview: LLM Study-Card Generator and Review Agent; Memory Map (Prototype): Step-by-Step C Memory Visualizer; B1 LeetReview; Ontario Infrastructure Projects Dashboard & Briefing Note |
| 493380 | iOS developer | 2/4 | 6 | 0 | Memo Clock (team project); B4 Memo Clock; Co-op Tracker: Full-Stack Job-Search Tracker; Memo Clock (team project); Memory Map (Prototype): Step-by-Step C Memory Visualizer; Algorithmic Logic & Programming Coursework |
