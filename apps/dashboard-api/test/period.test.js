import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCalendarDayLabel,
  formatPeriodLabel,
  kpiPeriodFilter,
  kpiTimeAnd,
  parseAnalyticsMinutes,
  parseCalendarDate,
  periodJson,
  periodToJson,
  resolveAnalyticsPeriod,
} from "../src/lib/period.js";

describe("parseAnalyticsMinutes", () => {
  it("parses all time", () => {
    assert.equal(parseAnalyticsMinutes("0"), 0);
    assert.equal(parseAnalyticsMinutes("all"), 0);
  });

  it("caps at 30 days", () => {
    assert.equal(parseAnalyticsMinutes("999999"), 43200);
  });

  it("allows 7 days", () => {
    assert.equal(parseAnalyticsMinutes("10080"), 10080);
  });
});

describe("kpiTimeAnd", () => {
  it("omits filter for all time", () => {
    const tf = kpiTimeAnd("window_start", 0, 1);
    assert.equal(tf.clause, "");
    assert.deepEqual(tf.params, []);
  });

  it("adds interval filter", () => {
    const tf = kpiTimeAnd("window_start", 60, 1);
    assert.match(tf.clause, /window_start/);
    assert.deepEqual(tf.params, [60]);
  });
});

describe("periodJson", () => {
  it("labels all time", () => {
    const p = periodJson(0);
    assert.equal(p.period_all_time, true);
    assert.equal(p.period_label, "toàn bộ dữ liệu");
  });
});

describe("formatPeriodLabel", () => {
  it("formats 7 days", () => {
    assert.equal(formatPeriodLabel(10080), "7 ngày gần nhất");
  });
});

describe("parseCalendarDate", () => {
  it("accepts valid YYYY-MM-DD", () => {
    assert.equal(parseCalendarDate("2026-05-15"), "2026-05-15");
  });

  it("rejects invalid dates", () => {
    assert.equal(parseCalendarDate("2026-02-30"), null);
    assert.equal(parseCalendarDate("bad"), null);
  });
});

describe("resolveAnalyticsPeriod", () => {
  it("prefers date over minutes", () => {
    const p = resolveAnalyticsPeriod({ minutes: 60, date: "2026-05-15" });
    assert.equal(p.type, "day");
    assert.equal(p.date, "2026-05-15");
  });
});

describe("kpiPeriodFilter day", () => {
  it("uses date bounds", () => {
    const tf = kpiPeriodFilter("window_start", { type: "day", date: "2026-05-15" }, 1);
    assert.match(tf.clause, /::date/);
    assert.deepEqual(tf.params, ["2026-05-15"]);
  });
});

describe("periodToJson", () => {
  it("includes period_date for day mode", () => {
    const j = periodToJson({
      type: "day",
      date: "2026-05-15",
      label: formatCalendarDayLabel("2026-05-15"),
    });
    assert.equal(j.period_date, "2026-05-15");
    assert.equal(j.period_minutes, null);
  });
});
