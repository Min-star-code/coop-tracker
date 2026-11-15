// Test-only accounts and data for the Playwright server.
export const ACCOUNTS = {
  owner: { email: "owner@e2e.test", password: "e2e-owner-password" },
  viewer: { email: "viewer@e2e.test", password: "e2e-viewer-password" },
};

export const FIXTURES = [
  { job_id: "100001", company: "Northwind", title: "QA Automation Co-op", status: "Applied", updated_at: "2026-11-01" },
  { job_id: "100002", company: "Contoso", title: "Frontend Developer", status: "Applied", updated_at: "2026-11-02" },
  { job_id: "100003", company: "Fabrikam", title: "Data Analyst", status: "Saved", updated_at: "2026-11-03" },
  { job_id: "100004", company: "Litware", title: "IT Support", status: "Skipped", updated_at: "2026-11-04" },
  { external_id: "linkedin-adatum-sdet", source: "linkedin", company: "Adatum", title: "SDET Intern",
    status: "Applied", updated_at: "2026-11-05", url: "https://example.com/jobs/sdet" },
];
