FROM node:16

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build
RUN mkdir /logs

VOLUME ["/logs:/logs"]
CMD ["node", "out/index.js", " > ", "logs/log.txt"]


