# Bridge JSON API on top of the Web Security Audit Tool image.
ARG BASE_IMAGE=web-security-audit-tool:local
FROM ${BASE_IMAGE}

WORKDIR /app
COPY bridge_api.py /app/bridge_api.py

ENV AUDIT_DB_URL=sqlite:////data/audit.db
EXPOSE 8000

CMD ["uvicorn", "bridge_api:app", "--host", "0.0.0.0", "--port", "8000"]
