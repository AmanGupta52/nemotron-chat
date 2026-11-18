# One container that serves the website and the API (same origin, cookie sessions work).
#   docker build -t nemotron-workbench .
#   docker run -p 8787:8787 --env-file backend/.env -e TRUST_PROXY=true nemotron-workbench
FROM node:20-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app/backend
ENV NODE_ENV=production PORT=8787 SERVE_WEB=true
COPY backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY backend/ ./
COPY --from=web /app/web/dist /app/web/dist
EXPOSE 8787
CMD ["node", "server.js"]
