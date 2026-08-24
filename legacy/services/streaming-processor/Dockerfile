FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY lib ./lib

ENV KAFKA_BOOTSTRAP_SERVERS=kafka:9092
ENV KAFKA_TOPIC_RAW=tracking_events_raw
ENV KAFKA_GROUP_ID=streaming-processor
ENV POSTGRES_HOST=postgres
ENV POSTGRES_PORT=5432
ENV POSTGRES_DB=realtime
ENV POSTGRES_USER=app
ENV POSTGRES_PASSWORD=app
ENV FLUSH_INTERVAL_SEC=5

CMD ["python", "-u", "main.py"]
