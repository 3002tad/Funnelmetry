/**
 * Enrich raw /api/funnel steps for BI tables & charts.
 */
export function buildFunnelRows(steps, labels = {}) {
  if (!steps?.length) return { rows: [], top: 0, summary: null };

  const top = Number(steps[0].count || 0);
  let worstIdx = -1;
  let worstDrop = 0;

  const rows = steps.map((s, i) => {
    const count = Number(s.count || 0);
    const prevCount = i > 0 ? Number(steps[i - 1].count || 0) : null;
    const dropRate = i === 0 ? 0 : Number(s.drop_off_rate || 0);
    const stepConv = prevCount > 0 ? count / prevCount : 1;
    const ofTotal = top > 0 ? count / top : 0;
    const lost = prevCount != null && prevCount > count ? prevCount - count : 0;

    if (i > 0 && dropRate > worstDrop) {
      worstDrop = dropRate;
      worstIdx = i;
    }

    return {
      step: s.step,
      label: labels[s.step] || s.step,
      index: i + 1,
      count,
      ofTotalPct: ofTotal * 100,
      stepConvPct: stepConv * 100,
      dropPct: dropRate * 100,
      lost,
      isFirst: i === 0,
      isLast: i === steps.length - 1,
      isWorst: false,
    };
  });

  if (worstIdx >= 0) rows[worstIdx].isWorst = true;

  const purchase = rows.find((r) => r.step === "purchase")?.count ?? rows[rows.length - 1]?.count ?? 0;

  const summary = {
    top,
    purchase,
    overallConvPct: top > 0 ? (purchase / top) * 100 : 0,
    worstStep: worstIdx >= 0 ? rows[worstIdx] : null,
    stepCount: rows.length,
  };

  return { rows, top, summary };
}

export function funnelDropSeries(rows) {
  return rows
    .filter((r) => !r.isFirst)
    .map((r) => ({
      name: r.label,
      lost: r.lost,
      retained: r.count,
      dropPct: r.dropPct,
    }));
}
