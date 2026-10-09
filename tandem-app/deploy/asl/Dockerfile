FROM python:3.12-slim-bookworm
WORKDIR /app
COPY deploy/asl/requirements.lock /app/requirements.lock
RUN python -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r requirements.lock \
    && python -m pip check \
    && useradd --system --uid 10001 --no-create-home asl
COPY server/asl_api.py server/asl_wsgi.py /app/server/
COPY asl/__init__.py asl/features.py /app/asl/
COPY deploy/asl/gunicorn.conf.py /app/gunicorn.conf.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ASL_MODEL_DIR=/models \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
USER 10001:10001
EXPOSE 5003
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; r=urllib.request.urlopen('http://127.0.0.1:5003/health',timeout=3); assert r.status==200 and r.read(16)==b'OK'"
CMD ["gunicorn", "--config", "/app/gunicorn.conf.py", "server.asl_wsgi:app"]
