/**
 * Discard Ollama polish that invents numbers/IDs not present in the grounded brief.
 */

function digitsIn(text) {
  return (String(text || "").match(/\d[\d.,]*/g) || []).map((s) => s.replace(/[.,]/g, ""));
}

/** @returns {boolean} */
export function isUnsafePolish(polished, brief) {
  if (!polished || !brief) return false;

  for (const m of polished.matchAll(/\b\d{4,8}\b/g)) {
    const id = m[0];
    if (brief.includes(id)) continue;
    if (/^20\d{2}$/.test(id)) continue;
    return true;
  }

  const pNums = digitsIn(polished).filter((n) => n.length >= 4).map(Number).filter(Number.isFinite);
  const bNums = digitsIn(brief).filter((n) => n.length >= 4).map(Number).filter(Number.isFinite);
  if (!pNums.length || !bNums.length) return false;

  const maxBrief = Math.max(...bNums);
  for (const n of pNums) {
    if (n > maxBrief * 3 && n > 1_000_000) return true;
  }
  return false;
}
