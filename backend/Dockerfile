FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p uploads temp

EXPOSE 3002

CMD ["node", "server.js"]