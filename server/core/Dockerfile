# The server image. The build context is a copy of the game's `server/`.
ARG NODE_IMAGE=node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9

# Only moves files, so it runs on the build host's platform and needs no emulation of the target platform.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS prepare
COPY . /prepare
WORKDIR /prepare
# `DEV`, `STG` or `PROD`. It has no default: a build that does not pass it fails, so it cannot keep DEV code by accident.
ARG OGW_ENV
# Outside DEV, the image holds no DEV code.
# The files stay owned by root and readable by the server process, whatever the modes in the build context are.
RUN case "$OGW_ENV" in \
    DEV) ;; \
    STG|PROD) rm -rf dev core/*/dev ;; \
    *) echo "build argument OGW_ENV must be DEV, STG or PROD, got '$OGW_ENV'" >&2; exit 1 ;; \
  esac \
  && rm -rf tests core/*/tests core/Dockerfile \
  && chmod -R a+rX,go-w .

FROM ${NODE_IMAGE}
# From another stage, so that no layer of the image holds what `prepare` removed.
COPY --from=prepare /prepare /server
WORKDIR /server
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["node", "core/start.ts"]
