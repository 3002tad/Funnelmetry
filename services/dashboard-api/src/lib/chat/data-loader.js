import {
  fetchBanners,
  fetchFunnel,
  fetchKpiComparison,
  fetchOverview,
  fetchProductAnomalies,
  fetchProductConversion,
  fetchRevenueTrend,
  fetchTopProducts,
} from "./queries.js";

const RUNNERS = {
  fetchOverview: (m) => fetchOverview(m).then((kpi) => ({ kpi })),
  fetchTopProducts: (m) => fetchTopProducts(m).then((products) => ({ products })),
  fetchProductAnomalies: (m) => fetchProductAnomalies(m).then((anomalies) => ({ anomalies })),
  fetchFunnel: (m) => fetchFunnel(m).then((funnel) => ({ funnel, ...funnel })),
  fetchBanners: (m) => fetchBanners(m).then((banners) => ({ banners })),
  fetchKpiComparison: (m) => fetchKpiComparison(m).then((comparison) => ({ comparison })),
  fetchRevenueTrend: (m) => fetchRevenueTrend(m).then((trend) => ({ trend })),
  fetchProductConversion: (m) =>
    fetchProductConversion(m).then((product_conversion) => ({ product_conversion })),
};

/** Run whitelisted tools in parallel; merge results. */
export async function loadDataByPlan(plan) {
  const { tools, minutes, intent } = plan;
  const names = tools?.length ? tools : ["fetchOverview"];
  const parts = await Promise.all(
    names.map(async (name) => {
      const run = RUNNERS[name];
      if (!run) return {};
      try {
        return await run(minutes);
      } catch (err) {
        console.warn(`chat tool ${name} failed:`, err.message);
        return {};
      }
    })
  );

  const data = Object.assign({}, ...parts);

  if (intent === "optimize" && !data.anomalies) {
    Object.assign(data, { anomalies: await fetchProductAnomalies(minutes) });
  }
  if (intent === "optimize" && !data.kpi) {
    data.kpi = await fetchOverview(minutes);
  }
  if (intent === "optimize" && !data.funnel) {
    const funnel = await fetchFunnel(minutes);
    Object.assign(data, { funnel, ...funnel });
  }

  return data;
}
