import {
  fetchBannerDetail,
  fetchBanners,
  fetchCatalogStats,
  fetchCategoryPerformance,
  fetchFunnel,
  fetchKpiComparison,
  fetchOverview,
  fetchProductAnomalies,
  fetchProductConversion,
  fetchProductDetail,
  fetchRevenueTrend,
  fetchSearchFilters,
  fetchTopProducts,
  fetchTopSearches,
} from "./queries.js";

const day = (plan) => plan?.calendar_date || null;

const RUNNERS = {
  fetchOverview: (m, plan) => fetchOverview(m, day(plan)).then((kpi) => ({ kpi })),
  fetchTopProducts: (m, plan) =>
    fetchTopProducts(m, 10, plan?.product_sort || "views", day(plan)).then((products) => ({
      products,
      product_sort: plan?.product_sort || "views",
    })),
  fetchProductAnomalies: (m, plan) =>
    fetchProductAnomalies(m, 5, day(plan)).then((anomalies) => ({ anomalies })),
  fetchFunnel: (m, plan) => fetchFunnel(m, day(plan)).then((funnel) => ({ funnel, ...funnel })),
  fetchBanners: (m, plan) => fetchBanners(m, 5, day(plan)).then((banners) => ({ banners })),
  fetchKpiComparison: (m) => fetchKpiComparison(m).then((comparison) => ({ comparison })),
  fetchRevenueTrend: (m, plan) => fetchRevenueTrend(m, 15, day(plan)).then((trend) => ({ trend })),
  fetchProductConversion: (m, plan) =>
    fetchProductConversion(m, 10, day(plan)).then((product_conversion) => ({ product_conversion })),
  fetchProductDetail: (m, plan) => {
    const ref = plan?.entities?.product_name || plan?.entities?.product_id;
    if (!ref) return Promise.resolve({});
    return fetchProductDetail(m, ref, day(plan)).then((product_detail) => ({ product_detail }));
  },
  fetchTopSearches: (m, plan) => fetchTopSearches(m, 10, day(plan)).then((searches) => ({ searches })),
  fetchSearchFilters: (m, plan) => fetchSearchFilters(m, 10, day(plan)).then((filters) => ({ filters })),
  fetchCategoryPerformance: (m, plan) =>
    fetchCategoryPerformance(m, 10, day(plan)).then((categories) => ({ categories })),
  fetchCatalogStats: () => fetchCatalogStats().then((catalog) => ({ catalog })),
  fetchBannerDetail: (m, plan) => {
    const ref = plan?.entities?.banner_id || plan?.entities?.banner_name;
    if (!ref) return Promise.resolve({});
    return fetchBannerDetail(m, ref, day(plan)).then((banner_detail) => ({ banner_detail }));
  },
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
        return await run(minutes, plan);
      } catch (err) {
        console.warn(`chat tool ${name} failed:`, err.message);
        return {};
      }
    })
  );

  const data = Object.assign({}, ...parts);

  const cal = day(plan);
  if (intent === "optimize" && !data.anomalies) {
    Object.assign(data, { anomalies: await fetchProductAnomalies(minutes, 5, cal) });
  }
  if (intent === "optimize" && !data.kpi) {
    data.kpi = await fetchOverview(minutes, cal);
  }
  if (intent === "optimize" && !data.funnel) {
    const funnel = await fetchFunnel(minutes, cal);
    Object.assign(data, { funnel, ...funnel });
  }

  return data;
}
