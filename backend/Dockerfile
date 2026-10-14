FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
RUN mkdir -p /app/private_uploads && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["node","src/server.js"]
