# REVIEWABLE RECIPE ONLY. No image built/published/registered by this draft.
# Required verified Agent37 Pi base digest. No fabricated published image tag.
ARG AGENT37_PI_IMAGE
FROM ${AGENT37_PI_IMAGE}
USER root
RUN mkdir -p /opt/dock-tools /etc/t3code && cd /opt/dock-tools && npm install --omit=dev t3@0.1.7 && HOME=/root /opt/dock-tools/node_modules/.bin/t3 --version && cp -a /root/.t3/runtime/versions/0.1.7 /opt/dock-t3-runtime && chmod -R a-w /opt/dock-t3-runtime
COPY policy.json settings.json /etc/t3code/
RUN chown -R root:root /etc/t3code && chmod 755 /etc/t3code && chmod 644 /etc/t3code/*.json
USER node
