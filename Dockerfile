FROM --platform=$BUILDPLATFORM node:26-bookworm AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN mkdir /package && npm pack --pack-destination /package

FROM node:26-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client procps tini \
    && rm -rf /var/lib/apt/lists/* \
    && touch /etc/even-keel-container
RUN --mount=type=bind,from=build,source=/package,target=/package \
    npm install --global /package/even-keel-*.tgz --no-audit --no-fund && npm cache clean --force

ENV EVEN_KEEL_HOST=0.0.0.0
EXPOSE 4747
USER node
WORKDIR /home/node
RUN even-keel --help > /dev/null
ENTRYPOINT ["tini", "--"]
CMD ["even-keel"]
