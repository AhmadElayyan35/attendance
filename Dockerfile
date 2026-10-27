FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache su-exec
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data
# PORT يُستبدل تلقائيًا بالقيمة التي تعطيها منصة الاستضافة (مثل Render).
ENV DB_PATH=/data/attendance.db PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=1m --timeout=5s CMD wget -qO- "http://localhost:${PORT}/api/health" || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
