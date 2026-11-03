# The server image. The build context is a copy of the game's `server/`.
ARG NODE_IMAGE=node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9

# Only moves files, so it runs on the build host's platform and needs no emulation of the target platform.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS prepare
COPY . /prepare
WORKDIR /prepare
# A server module list without the DEV module `cheat` is that of an environment without DEV code (STG, PROD).
# The files stay owned by root and readable by the server process, whatever the modes in the build context are.
RUN rm -rf tests core/*/tests core/Dockerfile \
  && if ! grep -q '"cheat"' generated/server_modules.json; then rm -rf dev core/*/dev; fi \
  && chmod -R a+rX,go-w .

FROM ${NODE_IMAGE}
# From another stage, so that no layer of the image holds what `prepare` removed.
COPY --from=prepare /prepare /server
WORKDIR /server
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["node", "core/start.ts"]
