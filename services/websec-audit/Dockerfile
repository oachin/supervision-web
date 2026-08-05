# Web Security Audit Tool — container image.
# Bundles the CLI and the FastAPI dashboard with all native libraries WeasyPrint
# needs for PDF reports, `nmap` for (authorized) port scans, and the deep
# external engines: `nuclei` (templated CVE/misconfig) and `testssl.sh` (deep TLS).
FROM python:3.12-slim

# Pinned engine versions (override at build time with --build-arg). Pinned rather
# than "latest" for reproducible, supply-chain-safe builds.
ARG NUCLEI_VERSION=3.3.0
ARG TESTSSL_VERSION=3.0.9
ARG TARGETARCH=amd64
# OWASP ZAP is opt-in: it pulls a JRE (~300 MB) so it is off by default.
#   docker compose build --build-arg WITH_ZAP=true
ARG WITH_ZAP=false
ARG ZAP_VERSION=2.16.1

# System libraries:
#   * WeasyPrint (Pango/Cairo/GDK-Pixbuf) for PDF reports
#   * nmap for (authorized) port scans
#   * curl/unzip/git to fetch the engines; testssl.sh needs bash/openssl/dig/hexdump
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libcairo2 \
        libffi8 shared-mime-info fonts-dejavu-core \
        nmap \
        curl unzip ca-certificates \
        bash openssl dnsutils bsdmainutils procps \
    && rm -rf /var/lib/apt/lists/*

# nuclei — templated CVE / misconfig / exposure scanner (single Go binary).
RUN curl -sSfL \
        "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH}.zip" \
        -o /tmp/nuclei.zip \
    && unzip -o /tmp/nuclei.zip -d /usr/local/bin nuclei \
    && rm /tmp/nuclei.zip \
    && nuclei -version \
    && nuclei -update-templates -disable-update-check || true   # pre-fetch templates (needs network)

# testssl.sh — deep TLS/SSL auditing (bash script + its own bundled openssl).
RUN curl -sSfL \
        "https://github.com/drwetter/testssl.sh/archive/refs/tags/v${TESTSSL_VERSION}.tar.gz" \
        -o /tmp/testssl.tgz \
    && mkdir -p /opt/testssl \
    && tar -xzf /tmp/testssl.tgz -C /opt/testssl --strip-components=1 \
    && rm /tmp/testssl.tgz \
    && ln -sf /opt/testssl/testssl.sh /usr/local/bin/testssl.sh \
    && testssl.sh --version || true

# OWASP ZAP baseline (web-application passive scanning) — enabled with
# `--build-arg WITH_ZAP=true`. Off by default because ZAP needs a JRE, which
# roughly triples the image size; without it the `zap` scanner simply reports
# "inconclusive" and the rest of the audit is unaffected.
# `zap-baseline.py` lives next to `zap.sh` in /opt/zap and is exposed through a
# small wrapper on PATH (with PYTHONPATH set) so it can import `zap_common`.
ARG WITH_ZAP
ARG ZAP_VERSION
RUN if [ "$WITH_ZAP" = "true" ]; then set -eux; \
        apt-get update && apt-get install -y --no-install-recommends default-jre-headless \
        && rm -rf /var/lib/apt/lists/* \
        && curl -sSfL "https://github.com/zaproxy/zaproxy/releases/download/v${ZAP_VERSION}/ZAP_${ZAP_VERSION}_Linux.tar.gz" \
             -o /tmp/zap.tgz \
        && mkdir -p /opt/zap \
        && tar -xzf /tmp/zap.tgz -C /opt/zap --strip-components=1 \
        && rm /tmp/zap.tgz \
        && curl -sSfL "https://raw.githubusercontent.com/zaproxy/zaproxy/v${ZAP_VERSION}/docker/zap-baseline.py" \
             -o /opt/zap/zap-baseline.py \
        && curl -sSfL "https://raw.githubusercontent.com/zaproxy/zaproxy/v${ZAP_VERSION}/docker/zap_common.py" \
             -o /opt/zap/zap_common.py \
        && pip install --no-cache-dir zaproxy "setuptools<81" \
        && printf '#!/bin/sh\nexec env PYTHONPATH=/opt/zap python3 /opt/zap/zap-baseline.py "$@"\n' \
             > /usr/local/bin/zap-baseline \
        && chmod +x /usr/local/bin/zap-baseline \
        && ln -sf /opt/zap/zap.sh /usr/local/bin/zap.sh; \
    fi

WORKDIR /app

# Install Python deps first so the layer is cached across code changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persist the SQLite DB and generated reports outside the image.
ENV AUDIT_DB_URL=sqlite:////data/audit.db \
    AUDIT_CONFIG=config/targets.yaml \
    AUDIT_WORKERS=auto \
    AUDIT_SCHEDULE_MINUTES=0 \
    AUDIT_SCHEDULE_AT= \
    AUDIT_DEEP= \
    AUDIT_AUTHORIZED=
RUN mkdir -p /data

EXPOSE 8000

# Default: serve the dashboard. Override the command to run a one-off CLI audit:
#   docker compose run --rm audit python main.py
CMD ["uvicorn", "dashboard.app:app", "--host", "0.0.0.0", "--port", "8000"]
