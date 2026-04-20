let alertStore = [];
let simulatedHealth = null;

function addAlert(severity, title, message, service) {
  alertStore.unshift({
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    severity,
    title,
    message,
    timestamp: new Date().toISOString(),
    service,
  });
  if (alertStore.length > 50) alertStore = alertStore.slice(0, 50);
}

function getAlerts() {
  return alertStore;
}

function getSimulatedHealth() {
  return simulatedHealth;
}

function setSimulatedHealth(value) {
  simulatedHealth = value;
}

module.exports = { addAlert, getAlerts, getSimulatedHealth, setSimulatedHealth };
