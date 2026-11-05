# Unpublished candidate. Old template revision1 needs the tested runtime repair.
# Required verified Agent37 Pi base digest. No fabricated published image tag.
ARG AGENT37_PI_IMAGE=ghcr.io/agent37-platform/pi@sha256:02c19e95f5750f5123fa0fcb88c376adb4fed031e0a3c9e32202f1ee83d7e26a
FROM ${AGENT37_PI_IMAGE}
USER root
# Upstream Pi deliberately grants passwordless sudo. Remove it before trusting root-owned policy.
RUN rm -f /etc/sudoers.d/99-node-nopasswd && SUDO_FORCE_REMOVE=yes apt-get purge -y sudo && find / -xdev -type f -perm /6000 -exec chmod a-s {} +
RUN NPM_CONFIG_PREFIX=/usr/local npm install -g --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@1.5.0 && /usr/local/bin/pi --version
RUN mkdir -p /opt/dock-tools /etc/t3code && cd /opt/dock-tools && npm install --omit=dev t3@0.1.7 && HOME=/root /opt/dock-tools/node_modules/.bin/t3 --version && cp -a /root/.t3/runtime/versions/0.1.7 /opt/dock-t3-runtime && test -x /usr/local/bin/pi
COPY infra/execution-private/repair.py /opt/dock-runtime-repair.py
RUN python3 /opt/dock-runtime-repair.py
COPY infra/execution-private/policy.json infra/execution-private/settings.json /etc/t3code/
COPY infra/execution-private/smoke.py /opt/dock-image-smoke.py
RUN chown -R root:root /etc/t3code && chmod 755 /etc/t3code && chmod 644 /etc/t3code/*.json
COPY node/dock-node/src/execution/scoped-relay.mjs node/dock-node/src/execution/chat-contract.mjs /opt/dock-relay/src/execution/
COPY node/dock-node/bin/dock-private-pi.mjs /opt/dock-relay/bin/
RUN chmod 555 /opt/dock-relay/bin/dock-private-pi.mjs && chown -R root:root /opt/dock-relay && chmod -R a-w /opt/dock-relay
USER node
# Catch root-only installer directory modes before publishing a workspace image.
RUN python3 /opt/dock-image-smoke.py && /usr/local/bin/pi --version
