import os

EXCHANGE = os.environ.get("RABBITMQ_EXCHANGE", "ecommerce.events")
EXCHANGE_TYPE = os.environ.get("RABBITMQ_EXCHANGE_TYPE", "topic")
TRACKING_QUEUE = os.environ.get("RABBITMQ_TRACKING_QUEUE", "tracking.business-events")
TRACKING_DLX = os.environ.get("RABBITMQ_TRACKING_DLX", "ecommerce.events.dlx")
TRACKING_DLQ = os.environ.get("RABBITMQ_TRACKING_DLQ", "tracking.business-events.dlq")
BINDING_KEYS = [
    k.strip()
    for k in os.environ.get(
        "RABBITMQ_TRACKING_BINDING_KEYS", "order.*,payment.*,inventory.*"
    ).split(",")
    if k.strip()
]


async def assert_tracking_topology(channel) -> None:
    await channel.declare_exchange(EXCHANGE, EXCHANGE_TYPE, durable=True)
    await channel.declare_exchange(TRACKING_DLX, "topic", durable=True)

    await channel.declare_queue(
        TRACKING_QUEUE,
        durable=True,
        arguments={
            "x-dead-letter-exchange": TRACKING_DLX,
            "x-dead-letter-routing-key": f"{TRACKING_QUEUE}.failed",
        },
    )
    await channel.declare_queue(TRACKING_DLQ, durable=True)
    await channel.bind_queue(TRACKING_DLQ, TRACKING_DLX, f"{TRACKING_QUEUE}.failed")

    for key in BINDING_KEYS:
        await channel.bind_queue(TRACKING_QUEUE, EXCHANGE, key)
