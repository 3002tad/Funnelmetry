export function buildBannerSummary(banners) {
  if (!banners?.length) {
    return {
      totalImpressions: 0,
      totalClicks: 0,
      avgCtrPct: 0,
      bannerCount: 0,
      best: null,
      worst: null,
      leaderShare: 0,
    };
  }

  const totalImpressions = banners.reduce((s, b) => s + Number(b.impressions || 0), 0);
  const totalClicks = banners.reduce((s, b) => s + Number(b.clicks || 0), 0);
  const avgCtrPct = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  const withImp = banners.filter((b) => Number(b.impressions) > 0);
  const best = withImp.length
    ? [...withImp].sort((a, b) => Number(b.ctr) - Number(a.ctr))[0]
    : null;
  const worst = withImp.length
    ? [...withImp].sort((a, b) => Number(a.ctr) - Number(b.ctr))[0]
    : null;
  const leader = banners[0];
  const leaderShare = totalImpressions > 0 && leader
    ? (Number(leader.impressions) / totalImpressions) * 100
    : 0;

  return {
    totalImpressions,
    totalClicks,
    avgCtrPct,
    bannerCount: banners.length,
    best,
    worst,
    leaderShare,
  };
}

export function buildBannerActionItems(summary) {
  if (!summary || summary.bannerCount === 0) return [];

  const bestCtr = summary.best ? Number(summary.best.ctr) * 100 : 0;
  const worstCtr = summary.worst ? Number(summary.worst.ctr) * 100 : 0;

  return [
    {
      key: "avg-ctr",
      level: summary.avgCtrPct < 1 ? "high" : summary.avgCtrPct < 2 ? "medium" : "good",
      title: "CTR trung bình",
      value: `${summary.avgCtrPct.toFixed(2)}%`,
      hint: summary.avgCtrPct < 1
        ? "CTR thấp — thử đổi creative, vị trí hoặc CTA banner."
        : "CTR tổng thể trong ngưỡng ổn.",
    },
    {
      key: "worst-banner",
      level: worstCtr < 0.5 ? "high" : worstCtr < 1 ? "medium" : "good",
      title: "Banner kém nhất",
      value: summary.worst ? `${worstCtr.toFixed(2)}%` : "—",
      hint: summary.worst
        ? `${summary.worst.banner_id} — cân nhắc tắt hoặc thay nội dung.`
        : "—",
    },
    {
      key: "imp-share",
      level: summary.leaderShare >= 75 ? "medium" : "good",
      title: "Tập trung impression",
      value: `${summary.leaderShare.toFixed(0)}%`,
      hint: summary.leaderShare >= 75
        ? "Một banner chiếm phần lớn hiển thị — phụ thuộc cao."
        : "Impression phân bổ đều hơn giữa các banner.",
    },
  ];
}

export function ctrLevel(ctr) {
  const p = Number(ctr || 0) * 100;
  if (p >= 3) return "ok";
  if (p >= 1) return "med";
  return "low";
}

export function ctrLabel(ctr) {
  const p = Number(ctr || 0) * 100;
  if (p >= 3) return "Tốt";
  if (p >= 1) return "Trung bình";
  return "Thấp";
}
