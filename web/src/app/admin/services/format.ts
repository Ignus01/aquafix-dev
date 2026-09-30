// Costs are shown with two decimals and no currency symbol: the source app
// stored plain decimals and the masterdata has no currency setting.
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The file grid shows sizes in MB.
export function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
