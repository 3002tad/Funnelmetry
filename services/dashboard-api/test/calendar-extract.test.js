import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCalendarDate } from "../src/lib/chat/calendar-extract.js";

describe("extractCalendarDate", () => {
  it("parses hôm nay", () => {
    const d = extractCalendarDate("doanh thu hôm nay");
    assert.ok(d);
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("parses hôm qua", () => {
    const d = extractCalendarDate("đơn hôm qua");
    assert.ok(d);
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns null when no calendar phrase", () => {
    assert.equal(extractCalendarDate("doanh thu 60 phút"), null);
  });
});
