# Dev image: Vite dev server with the source bind-mounted by compose.yaml.
# node_modules is installed in the image (the host's may have other native binaries).
FROM node:24-slim

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

EXPOSE 5173 4173
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
