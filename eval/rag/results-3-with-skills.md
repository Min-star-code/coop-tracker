# RAG tailoring helper: eval (3-with-skills)

Models: gemini-embedding-001 (embeddings, 768 dims), gemini-3.5-flash-lite (generation). k = 8. Date: 2026-11-15. Postings: 8. Index: 403 chunks.

## Retrieval (labels: which of my projects / paragraphs should come back)

- **Hit rate@8: 8/8 (100.0%)** postings got at least one expected source in the top 8
- **Recall@8: 65.1%** of expected sources retrieved, averaged over postings

## Faithfulness (generation)

- Picks shown: 33; picks the guard dropped: **0** (cited an unretrieved excerpt or a number not in the excerpt/posting)
- "Requirement" phrases not found word for word in the posting (kept, flagged): 1/33
- Picks that are an expected source: 18/33
- Every shown suggestion is the stored text of a retrieved chunk, so a suggestion cannot contain a claim
  that is not in my own material; only the one-line "why" is model-written, and it is checked for numbers.

| posting | kind | expected found | picks | dropped | picked sources |
|---|---|---|---|---|---|
| 492696 | QA automation | 4/5 | 4 | 0 | Skills: Tools; Skills: Web & AI tools; Memory Map (Prototype): Step-by-Step C Memory Visualizer; B3 Memo Clock |
| 493445 | software test | 3/5 | 4 | 0 | B1 LeetReview; Co-op Tracker: Full-Stack Job-Search Tracker; Skills: Tools; Memory Map (Prototype): Step-by-Step C Memory Visualizer |
| 493315 | web developer | 3/5 | 2 | 0 | Skills: Web & AI tools; Memory Map (Prototype): Step-by-Step C Memory Visualizer |
| 493134 | data analyst | 6/7 | 6 | 0 | Skills: Data & Reporting; Ontario Infrastructure Projects Dashboard & Briefing Note; C1 Toronto; Ontario Labour Market Analysis: LFS & Job Vacancies; TTC Subway Delay Incident Analysis; AdventureWorks Sales & Profitability Analysis |
| 492619 | UX design | 1/4 | 4 | 0 | Skills: Design & Media; Skills: Web & AI tools; Memo Clock (team project); Memory Map (Prototype): Step-by-Step C Memory Visualizer |
| 492994 | project coordinator | 3/5 | 4 | 0 | Skills: Microsoft 365; Skills: Office & Design; C1 Toronto; Class President |
| 492837 | AI engineering | 3/3 | 5 | 0 | Skills: Programming; LeetReview: LLM Study-Card Generator and Review Agent; Co-op Tracker: Full-Stack Job-Search Tracker; Memory Map (Prototype): Step-by-Step C Memory Visualizer; B1 LeetReview |
| 493380 | iOS developer | 2/4 | 4 | 0 | Memo Clock (team project); B4 Memo Clock; Skills: Web & AI tools; Co-op Tracker: Full-Stack Job-Search Tracker |
