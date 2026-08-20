FROM node:22-alpine

WORKDIR /app

# Camada de dependências separada: só reinstala quando o package muda.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Não rodar como root: limita o estrago de uma eventual RCE.
USER node

EXPOSE 8080
CMD ["node", "src/index.js"]
