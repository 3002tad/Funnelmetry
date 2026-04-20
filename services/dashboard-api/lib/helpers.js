function getIntervalExpression(timeRange) {
  switch (timeRange) {
    case "5m":  return "5 minutes";
    case "15m": return "15 minutes";
    case "30m": return "30 minutes";
    case "1h":  return "1 hour";
    case "24h": return "24 hours";
    default:    return "1 hour";
  }
}

module.exports = { getIntervalExpression };
