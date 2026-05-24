FROM node:20-alpine AS build

WORKDIR /app

COPY clients/demo-shop/package.json ./clients/demo-shop/
COPY sdk/browser-behavior-sdk ./sdk/browser-behavior-sdk

WORKDIR /app/clients/demo-shop
RUN npm install

COPY clients/demo-shop ./

ARG VITE_TRACKING_API_URL=http://localhost:3100
ENV VITE_TRACKING_API_URL=$VITE_TRACKING_API_URL

RUN npm run build

FROM nginx:alpine
COPY clients/demo-shop/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/clients/demo-shop/dist /usr/share/nginx/html
EXPOSE 80
