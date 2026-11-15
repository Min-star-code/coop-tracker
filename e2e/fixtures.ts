// Test-only accounts and data for the Playwright server.
export const ACCOUNTS = {
  owner: { email: "owner@e2e.test", password: "e2e-owner-password" },
  viewer: { email: "viewer@e2e.test", password: "e2e-viewer-password" },
};

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export const FIXTURES = [
  { job_id: "100001", company: "Northwind", title: "QA Automation Co-op", status: "Applied", updated_at: "2026-11-01" },
  { job_id: "100002", company: "Contoso", title: "Frontend Developer", status: "Applied", updated_at: "2026-11-02" },
  { job_id: "100003", company: "Fabrikam", title: "Data Analyst", status: "Saved", updated_at: "2026-11-03" },
  { job_id: "100004", company: "Litware", title: "IT Support", status: "Skipped", updated_at: "2026-11-04" },
  { external_id: "linkedin-adatum-sdet", source: "linkedin", company: "Adatum", title: "SDET Intern",
    status: "Applied", updated_at: "2026-11-05", url: "https://example.com/jobs/sdet" },
  { job_id: "100006", company: "Initech", title: "Software Tester", status: "Saved", updated_at: "2026-11-06",
    category: "waterloo", brief: "Manual and automated testing for a web app.", location: "Waterloo hybrid",
    duration: "4 months", applicants: 12, cl_required: false, deadline: inDays(6) },
  { job_id: "100007", company: "Globex", title: "Junior Developer", status: "Saved", updated_at: "2026-11-07",
    category: "other", brief: "React front end.", location: "Toronto", duration: "4 months", applicants: 40,
    cl_required: true, deadline: inDays(2) },
];
