FROM docker:29-cli AS docker_cli

FROM node:22-alpine
COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /workspace
COPY tools/autoscaler/policy.mjs tools/autoscaler/observe.mjs tools/autoscaler/
COPY tools/swarm-controllers/policy.mjs tools/swarm-controllers/controller.mjs tools/swarm-controllers/docker.mjs tools/swarm-controllers/broker.mjs tools/swarm-controllers/
EXPOSE 32130
CMD ["node", "/workspace/tools/swarm-controllers/broker.mjs", "/run/config/controller.json", "/run/secrets/broker_token"]
