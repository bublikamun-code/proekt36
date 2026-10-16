# Multi-stage build: node builds the static bundle, nginx serves it.
# The app is fully client-side, so the runtime image carries no Node at all.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx-default.conf /etc/nginx/conf.d/default.conf

# The same CSP the build embeds as a meta tag is sent as a header too — see nginx-default.conf.

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
