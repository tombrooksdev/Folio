FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY CHANGELOG.md ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV FOLIO_DB=/data/folio.db PORT=3000
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
