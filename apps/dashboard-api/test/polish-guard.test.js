import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUnsafePolish } from "../src/lib/chat/polish-guard.js";

describe("isUnsafePolish", () => {
  it("rejects invented long numeric IDs", () => {
    const brief = "Đơn ORD-001: 1.200.000 ₫";
    const bad = "Chi tiết đơn 12345678 gồm sản phẩm A.";
    assert.equal(isUnsafePolish(bad, brief), true);
  });

  it("allows polish that only rephrases brief numbers", () => {
    const brief = "Doanh thu 5.400.000 ₫ trong 60 phút gần nhất.";
    const ok = "Trong 60 phút vừa rồi, doanh thu đạt 5.400.000 ₫.";
    assert.equal(isUnsafePolish(ok, brief), false);
  });
});
