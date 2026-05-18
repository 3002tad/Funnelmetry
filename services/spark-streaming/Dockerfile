FROM python:3.11-slim

WORKDIR /app

COPY spark_stream.py .

ENV KAFKA_BOOTSTRAP_SERVERS=kafka:9092
ENV POSTGRES_HOST=postgres
ENV POSTGRES_PORT=5432
ENV POSTGRES_DB=realtime
ENV POSTGRES_USER=app
ENV POSTGRES_PASSWORD=app

CMD ["python", "-u", "spark_stream.py"]
