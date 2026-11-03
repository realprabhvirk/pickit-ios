export function formatBytes(n: number): string {
  if (n < 1000) return `${n} bytes`;
  if (n < 1000 * 1000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} KB`;
  if (n < 1000 * 1000 * 1000) return `${(n / 1_000_000).toFixed(1)} MB`;
  return `${(n / 1_000_000_000).toFixed(2)} GB`;
}
