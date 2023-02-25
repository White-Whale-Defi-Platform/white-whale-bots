FROM node:19

ENV TERM=xterm
RUN mkdir /usr/src/app
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY .eslintrc ./
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

CMD ["node", "out/index.js"]
