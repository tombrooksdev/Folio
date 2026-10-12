# Pinned by digest so the base image can't change under us. Dependabot proposes updates.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY CHANGELOG.md ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production FOLIO_DB=/data/folio.db FOLIO_UPLOAD_DIR=/data/uploads PORT=3000
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
