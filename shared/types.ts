export type ChangeType = "added" | "removed" | "changed" | "unchanged";
export type CsvInput = { csv: string; filename: string; delimiter: string };
export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  delimiter: string;
};
export type Change = {
  type: ChangeType;
  key: string;
  field: string;
  before: string | null;
  after: string | null;
};
export type ComparisonResult = {
  key: string;
  stats: Record<ChangeType, number>;
  changes: Change[];
  beforeRows: number;
  afterRows: number;
  addedColumns: string[];
  removedColumns: string[];
};
export type ReportSummary = {
  id: string;
  name: string;
  notes: string;
  key: string;
  beforeFilename: string;
  afterFilename: string;
  stats: ComparisonResult["stats"];
  createdAt: string;
  updatedAt: string;
};
export type Report = ReportSummary & { result: ComparisonResult };
