import fp from "fastify-plugin";
import amqplib, { ChannelModel } from "amqplib";
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";

type QueueConfig =
  | {
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
      headers: Record<string, string>;
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

async function createChannels(
  options: CreateChannelsOptions
): Promise<amqplib.Channel[]> {
  const { connectConfig, size = 1, exchanges = [], queues = [] } = options;
  const channels: amqplib.Channel[] = [];

  if (size < 1) return channels;

  const connection = await amqplib.connect(connectConfig);

  for (let i = 1; i <= size; i++) {
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
      const { queue: queueName } = await channel.assertQueue(
        queue.name || "",
        queue.options
      );

      if ("type" in queue && "exchange" in queue) {
        switch (queue.type) {
          case "topic":
          case "direct":
            await channel.bindQueue(
              queueName,
              queue.exchange,
              queue.routingKey
            );
            break;

          case "headers":
            await channel.bindQueue(
              queueName,
              queue.exchange,
              "",
              queue.headers
            );
            break;

          default:
            await channel.bindQueue(queueName, queue.exchange, "");
            break;
        }
      }
    }

    channels.push(channel);
  }

  return channels;
}

interface CreateChannelsOptions extends AMQPPluginOptions {
  size: number;
}

interface AMQPPluginOptions {
  connectConfig: string | amqplib.Options.Connect;
  exchanges?: ExchangeConfig[];
  queues?: QueueConfig[];
}

async function amqp(fastify: FastifyInstance, options: AMQPPluginOptions) {
  const [publishChannel, consumeChannel] = await createChannels({
    ...options,
    size: 2,
  });
  await consumeChannel.prefetch(10); // tối ưu QoS

  //   async function publish(exchange, routingKey, message, options = {}) {
  //     const buffer = Buffer.from(JSON.stringify(message));
  //     return publishChannel.publish(exchange, routingKey, buffer, options);
  //   }

  //   async function sendToQueue(queue, message, options = {}) {
  //     const buffer = Buffer.from(JSON.stringify(message));
  //     return publishChannel.sendToQueue(queue, buffer, options);
  //   }

  fastify.get("/test", async (req: FastifyRequest, reply: FastifyReply) => {});

  //   conn.on("close", () => {
  //     console.log("first");
  //   });
}

export default fp(amqp, {
  name: "amqpPlugin",
});
