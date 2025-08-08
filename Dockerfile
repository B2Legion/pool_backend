# Multi-stage build for production
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

FROM base AS production
COPY --from=build /app .
EXPOSE 8080
USER node
CMD ["npm", "start"]