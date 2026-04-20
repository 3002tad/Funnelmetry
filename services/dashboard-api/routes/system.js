const express = require("express");
const { addAlert, getAlerts, getSimulatedHealth, setSimulatedHealth } = require("../lib/state");

const router = express.Router();

// GET /api/alerts
router.get("/alerts", (req, res) => {
  res.json(getAlerts());
});

// POST /api/simulate  { type: 'kafka_down' | 'spark_crash' | 'reset' }
router.post("/simulate", (req, res) => {
  const { type } = req.body;
  const current = getSimulatedHealth();

  if (type === "reset") {
    setSimulatedHealth(null);
    addAlert("info", "System Reset", "All systems restored to normal state", "system");
  } else if (type === "kafka_down") {
    const next = current
      ? { ...current, kafka: { status: "down", message: "Connection timeout - brokers unreachable" } }
      : {
          kafka: { status: "down", message: "Connection timeout - brokers unreachable" },
          spark: { status: "degraded", message: "Cannot consume from Kafka" },
          postgres: { status: "healthy", message: "Database responsive" },
        };
    setSimulatedHealth(next);
    addAlert("critical", "Kafka Cluster Down", "Unable to connect to Kafka brokers", "kafka");
  } else if (type === "spark_crash") {
    const next = current
      ? { ...current, spark: { status: "down", message: "Streaming job failed - OOM error" } }
      : {
          kafka: { status: "healthy", message: "All brokers operational" },
          spark: { status: "down", message: "Streaming job failed - OOM error" },
          postgres: { status: "healthy", message: "Database responsive" },
        };
    setSimulatedHealth(next);
    addAlert("critical", "Spark Job Crashed", "Streaming application terminated unexpectedly", "spark");
  } else {
    return res.status(400).json({ error: "Unknown simulation type" });
  }

  res.json(
    getSimulatedHealth() || {
      kafka: { status: "healthy", message: "All brokers operational" },
      spark: { status: "healthy", message: "Streaming jobs running" },
      postgres: { status: "healthy", message: "Database responsive" },
    },
  );
});

module.exports = router;
