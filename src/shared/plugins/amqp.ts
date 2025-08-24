import fp from "fastify-plugin";
import amqplib from "amqplib";
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";

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

declare module "fastify" {
  interface FastifyRequest {
    publish: (params: Publish) => void;
    sendToQueue: (params: SendToQueue) => void;
  }
}

interface CreateChannelOptions {
  connection: amqplib.ChannelModel;
  exchanges?: ExchangeConfig[];
  queues?: QueueConfig[];
}

async function createChannel(
  options: CreateChannelOptions
): Promise<amqplib.Channel> {
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

interface AMQPPluginOptions {
  connectConfig: string | amqplib.Options.Connect;
  exchanges?: ExchangeConfig[];
  queues?: QueueConfig[];
  prefetch?: number;
  consumes?: Consume[];
}

interface SendToQueue {
  queue: string;
  message: string;
  options?: amqplib.Options.Publish;
}

type Publish =
  | {
      type: "fanout";
      exchange: string;
      message: string;
      options?: Omit<amqplib.Options.Publish, "headers">;
    }
  | {
      type: "headers";
      exchange: string;
      headers: Record<string, string>;
      message: string;
      options?: Omit<amqplib.Options.Publish, "headers">;
    }
  | {
      type: "direct" | "topic";
      exchange: string;
      routingKey: string;
      message: string;
      options?: Omit<amqplib.Options.Publish, "headers">;
    };

type Consume = {
  queue: string;
  callback: (msg: amqplib.ConsumeMessage, channel: amqplib.Channel) => void;
  options?: amqplib.Options.Consume;
};

async function amqp(fastify: FastifyInstance, options: AMQPPluginOptions) {
  const {
    connectConfig,
    exchanges = [],
    queues = [],
    prefetch,
    consumes = [],
  } = options;

  const connection = await amqplib.connect(connectConfig);

  const consumeChannel = await createChannel({
    connection,
    exchanges,
    queues,
  });

  if (prefetch) {
    await consumeChannel.prefetch(prefetch || 10); // tối ưu QoS
  }

  for (let { queue, callback } of consumes) {
    await consumeChannel.consume(queue, async (msg) => {
      if (msg) {
        callback(msg, consumeChannel);
      }
    });
  }

  const publishChannel = await createChannel({
    connection,
    exchanges,
    queues,
  });

  connection.on("close", () => {
    console.log("connection close");
  });

  connection.on("error", () => {
    console.log("connection error");
  });

  function publish(params: Publish): void {
    const { exchange, type, message, options = { persistent: true } } = params;
    const buffer = Buffer.from(JSON.stringify(message));

    switch (type) {
      case "direct":
      case "topic":
        const { routingKey } = params;
        publishChannel.publish(exchange, routingKey, buffer, options);
        break;

      case "headers":
        const { headers } = params;
        publishChannel.publish(exchange, "", buffer, {
          headers,
          ...options,
        });
        break;

      default:
        publishChannel.publish(exchange, "", buffer, options);
        break;
    }
  }

  function sendToQueue(params: SendToQueue): void {
    const { queue, message, options = { persistent: true } } = params;
    const buffer = Buffer.from(JSON.stringify(message));
    publishChannel.sendToQueue(queue, buffer, options);
  }

  fastify.decorateRequest("publish", publish);
  fastify.decorateRequest("sendToQueue", sendToQueue);

  fastify.addHook("onClose", async () => {
    await publishChannel.close();
    await consumeChannel.close();
    await connection.close();
  });

  fastify.get(
    "/amqp/queue",
    async (req: FastifyRequest, reply: FastifyReply) => {
      req.sendToQueue({
        queue: "test-queue",
        message: "test message",
        options: {
          persistent: true,
        },
      });

      reply.code(200).send("oke");
    }
  );

  fastify.get(
    "/amqp/exchange/fanout",
    async (req: FastifyRequest, reply: FastifyReply) => {
      req.publish({
        type: "fanout",
        exchange: "exchange-fanout",
        message: "test-exchange-fanout",
        options: {
          persistent: true,
        },
      });

      reply.code(200).send("oke");
    }
  );

  fastify.post(
    "/amqp/exchange/headers",
    async (
      req: FastifyRequest<{ Body: Record<string, string> }>,
      reply: FastifyReply
    ) => {
      req.publish({
        type: "headers",
        exchange: "exchange-headers",
        message: JSON.stringify({ ...req.body }),
        headers: req.body,
        options: {
          persistent: true,
        },
      });

      reply.code(200).send("oke");
    }
  );

  fastify.post(
    "/amqp/exchange/direct",
    async (
      req: FastifyRequest<{
        Body: {
          routingKey: string;
          message: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      req.publish({
        type: "direct",
        exchange: "exchange-direct",
        message: JSON.stringify(req.body.message),
        routingKey: req.body.routingKey,
        options: {
          persistent: true,
        },
      });

      reply.code(200).send("oke");
    }
  );

  fastify.post(
    "/amqp/exchange/topic",
    async (
      req: FastifyRequest<{
        Body: {
          routingKey: string;
          message: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      req.publish({
        type: "topic",
        exchange: "exchange-topic",
        message: JSON.stringify(req.body.message),
        routingKey: req.body.routingKey,
        options: {
          persistent: true,
        },
      });

      reply.code(200).send("oke");
    }
  );
}

export default fp(amqp, {
  name: "amqpPlugin",
});
