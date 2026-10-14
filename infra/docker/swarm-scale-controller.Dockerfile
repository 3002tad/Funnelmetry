FROM node:22-alpine
WORKDIR /workspace
COPY tools/autoscaler/policy.mjs tools/autoscaler/observe.mjs tools/autoscaler/
COPY tools/swarm-controllers/policy.mjs tools/swarm-controllers/controller.mjs tools/swarm-controllers/docker.mjs tools/swarm-controllers/broker-client.mjs tools/swarm-controllers/broker-runner.mjs tools/swarm-controllers/boundary-smoke.mjs tools/swarm-controllers/
CMD ["node", "/workspace/tools/swarm-controllers/broker-runner.mjs", "/run/config/controller.json", "/state/state.json", "/run/secrets/broker_token"]
