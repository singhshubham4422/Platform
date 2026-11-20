/** Line-level change marking using a longest-common-subsequence table (inputs are small source files). */
export function changedLines(prev: string, next: string): Set<number> {
  const a = prev.split("\n");
  const b = next.split("\n");
  if (a.length * b.length > 400_000) return new Set(b.map((_, i) => i).filter((i) => a[i] !== b[i]));
  const w = b.length + 1;
  const dp = new Int32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? (dp[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + j + 1] ?? 0);
    }
  }
  const kept = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kept.add(j);
      i++;
      j++;
    } else if ((dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + j + 1] ?? 0)) i++;
    else j++;
  }
  return new Set(b.map((_, k) => k).filter((k) => !kept.has(k)));
}
