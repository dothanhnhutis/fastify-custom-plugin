import amqplib from "amqplib";

type Consume = {
  queue: string;
  callback: (msg: amqplib.ConsumeMessage, channel: amqplib.Channel) => void;
  options?: amqplib.Options.Consume;
};

interface AMQPOptions {
  connectConfig: string | amqplib.Options.Connect;
  exchanges?: ExchangeConfig[];
  queues?: QueueConfig[];
  prefetch?: number;
  consumes?: Consume[];
}

type QueueConfig =
  | {
      type: "queue";
      name: string;
      options?: amqplib.Options.AssertQueue;
    }
  | {
      type: "direct" | "topic";
      exchange: string;
      name?: string;
      routingKey: string;
      options?: amqplib.Options.AssertQueue;
    }
  | {
      type: "headers";
      exchange: string;
      name?: string;
      headers: { "x-match": "all" | "any"; [index: string]: string };
      options?: amqplib.Options.AssertQueue;
    }
  | {
      type: "fanout";
      exchange: string;
      name?: string;
      options?: amqplib.Options.AssertQueue;
    };

export interface ExchangeConfig {
  name: string;
  type: "direct" | "topic" | "fanout" | "headers";
  options?: amqplib.Options.AssertExchange;
}
class AMQP {
  private connectConfig: string | amqplib.Options.Connect;
  private connection: amqplib.ChannelModel | null = null;

  constructor(options: AMQPOptions) {
    this.connectConfig = options.connectConfig;
  }

  async connect() {
    if (this.connection) return;
    try {
      this.connection = await amqplib.connect(this.connectConfig);
    } catch (error) {}
  }

  private async createChannel(options: {
    exchanges?: ExchangeConfig[];
    queues?: QueueConfig[];
  }): Promise<amqplib.Channel> {
    const { connection, exchanges = [], queues = [] } = options;
    const channel = await connection.createChannel();

    // Thiết lập exchanges
    for (const exchange of exchanges) {
      await channel.assertExchange(
        exchange.name,
        exchange.type,
        exchange.options
      );
    }

    // Thiết lập queues
    for (const queue of queues) {
      switch (queue.type) {
        case "queue":
          await channel.assertQueue(queue.name || "", queue.options);
          break;

        case "topic":
        case "direct":
          const q_topic_or_direct = await channel.assertQueue(
            queue.name || "",
            queue.options
          );
          await channel.bindQueue(
            q_topic_or_direct.queue,
            queue.exchange,
            queue.routingKey
          );
          break;

        case "headers":
          const q_headers = await channel.assertQueue(
            queue.name || "",
            queue.options
          );
          await channel.bindQueue(
            q_headers.queue,
            queue.exchange,
            "",
            queue.headers
          );
          break;

        default:
          const q_fanout = await channel.assertQueue(
            queue.name || "",
            queue.options
          );
          await channel.bindQueue(q_fanout.queue, queue.exchange, "");
          break;
      }
    }

    return channel;
  }
}
