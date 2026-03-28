FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install
RUN npm ls express 2>/dev/null || npm install --no-save express

COPY . .

EXPOSE 3000

CMD sh -c "node dev-api-server.js & npm start"
