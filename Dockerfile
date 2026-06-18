FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY vendor ./vendor
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk upgrade --no-cache libcrypto3 libssl3
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev \
  && rm -f package-lock.json \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY assets ./assets
CMD ["node", "dist/root.js"]
