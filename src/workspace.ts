import type { Report, ReportSummary } from "../shared/types";

export async function loadWorkspace(
  requestedReportId: string | null,
  read: <T>(path: string) => Promise<T>,
) {
  await read("/api/session");
  const { reports } = await read<{ reports: ReportSummary[] }>(
    "/api/comparisons",
  );
  // The recent-history window is not the full set of accessible reports.
  const id = requestedReportId || reports[0]?.id;
  const report = id
    ? await read<Report>(`/api/comparisons/${encodeURIComponent(id)}`)
    : null;
  return { reports, report };
}
