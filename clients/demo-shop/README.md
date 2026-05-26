# demo-shop

React demo TMĐT + Behavior SDK. Backend **k3s** trên WSL2.

## Pages

`/`, `/products`, `/products/:id`, `/cart`, `/checkout`, `/thank-you`

## Run (dev)

```bash
# infra/.env — VITE_TRACKING_API_URL=http://<WSL_IP>:31000
npm install
npm run dev
# → http://localhost:5173
```

Ports: [`infra/PORTS.md`](../../infra/PORTS.md)
