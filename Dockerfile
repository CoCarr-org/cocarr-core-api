# cocarr-core-api — production image
# Node 20 (Debian slim) so sharp/mysql2 use prebuilt binaries.
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

# Install production deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# App source (includes the committed KYC public key).
COPY . .

# App reads process.env.PORT (Railway injects it); 3030 is the fallback.
EXPOSE 3030

CMD ["node", "index.js"]
