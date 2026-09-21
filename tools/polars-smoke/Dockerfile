FROM python:3.12-slim
RUN pip install --no-cache-dir --timeout 60 --retries 2 polars==1.34.0
WORKDIR /tool
COPY analyze.py test_analyze.py ./
ENTRYPOINT ["python", "analyze.py"]
