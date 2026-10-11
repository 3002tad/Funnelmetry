FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY apps/dashboard-web/package.json apps/dashboard-web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/dashboard-web/ ./
# Public configuration only. API traffic stays on the browser's own origin.
ENV VITE_DASHBOARD_API_URL=/
RUN npm run build

FROM nginx:stable-alpine
COPY apps/dashboard-web/nginx-main.conf /etc/nginx/nginx.conf
COPY apps/dashboard-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
