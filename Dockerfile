FROM node:22-alpine
WORKDIR /app
COPY voice-server/package.json voice-server/package-lock.json ./
RUN node -v && npm ci --omit=dev
COPY voice-server/src ./src
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/server.js"]
