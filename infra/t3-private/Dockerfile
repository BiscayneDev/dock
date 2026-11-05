# Built as private workspace template dock-t3-owner-20261104@1. No instance launched.
# Required verified Agent37 Pi base digest. No fabricated published image tag.
ARG AGENT37_PI_IMAGE=ghcr.io/agent37-platform/pi@sha256:02c19e95f5750f5123fa0fcb88c376adb4fed031e0a3c9e32202f1ee83d7e26a
FROM ${AGENT37_PI_IMAGE}
USER root
# Upstream Pi deliberately grants passwordless sudo. Remove it before trusting root-owned policy.
RUN rm -f /etc/sudoers.d/99-node-nopasswd && SUDO_FORCE_REMOVE=yes apt-get purge -y sudo && find / -xdev -type f -perm /6000 -exec chmod a-s {} +
RUN NPM_CONFIG_PREFIX=/usr/local npm install -g --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@1.5.0 && /usr/local/bin/pi --version
RUN mkdir -p /opt/dock-tools /etc/t3code && cd /opt/dock-tools && npm install --omit=dev t3@0.1.7 && HOME=/root /opt/dock-tools/node_modules/.bin/t3 --version && cp -a /root/.t3/runtime/versions/0.1.7 /opt/dock-t3-runtime && chmod -R a+rX,a-w /opt/dock-t3-runtime && test -x /usr/local/bin/pi
COPY policy.json settings.json /etc/t3code/
COPY smoke.py /opt/dock-image-smoke.py
RUN chown -R root:root /etc/t3code && chmod 755 /etc/t3code && chmod 644 /etc/t3code/*.json
USER node
# Catch root-only installer directory modes before publishing a workspace image.
RUN python3 /opt/dock-image-smoke.py && /usr/local/bin/pi --version
