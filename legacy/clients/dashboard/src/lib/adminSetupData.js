/** Static V1 demo/ports — see legacy/docs-v1/RUNTIME.md §5. */
function hostFromDashboardApiUrl() {
  const raw = import.meta.env.VITE_DASHBOARD_API_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

export function buildAdminSetupData() {
  const host = hostFromDashboardApiUrl() || "172.29.248.123";

  return {
    wsl_ip_hint: host,
    source: "client",
    ports: [
      { service: "tracking-api", nodePort: 31000, internal: "tracking-api:3000", use: "SDK POST /track" },
      { service: "commerce-backend", nodePort: 30330, internal: "commerce-backend:3000", use: "POST /api/orders → RabbitMQ" },
      { service: "dashboard-api", nodePort: 32000, internal: "dashboard-api:3000", use: "Vite proxy /api (dev)" },
      { service: "dashboard-ui", nodePort: 30809, internal: "dashboard-ui:80", use: "Production UI" },
    ],
    cluster_only: [
      { service: "kafka", port: 9092 },
      { service: "postgres", port: 5432 },
      { service: "rabbitmq", port: "5672 / 15672" },
      { service: "qdrant", port: 6333 },
      { service: "ollama", port: 11434 },
    ],
    env_examples: {
      web_shop: {
        TRACKING_FORWARD_URL: `http://${host}:31000/track`,
        COMMERCE_BACKEND_URL: `http://${host}:30330`,
      },
      dashboard_dev: {
        VITE_DASHBOARD_API_URL: `http://${host}:32000`,
        VITE_TRACKING_API_URL: `http://${host}:31000`,
      },
    },
    deploy: "k3s kubectl apply -k infra/k8s/sprint3",
    docs: ["legacy/docs-v1/RUNTIME.md", "docs/README.md"],
    k8s_dashboard: {
      title: "Headlamp (Kubernetes UI)",
      description:
        "Kubernetes web UI thuộc SIG UI, thay cho Kubernetes Dashboard cũ.",
      quick_open: "bash infra/k8s/ops/kubernetes-dashboard/open-headlamp.sh",
      install: "bash infra/k8s/ops/kubernetes-dashboard/install.sh",
      token: "bash infra/k8s/ops/kubernetes-dashboard/create-admin-token.sh",
      access: "bash infra/k8s/ops/kubernetes-dashboard/port-forward.sh → http://localhost:8443",
      docs_url:
        "https://headlamp.dev/docs/latest/installation/in-cluster/",
      readme: "infra/k8s/ops/kubernetes-dashboard/README.md",
    },
  };
}
