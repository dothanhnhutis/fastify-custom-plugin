import fp from "fastify-plugin";
import amqplib, { ChannelModel } from "amqplib";
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";

type PublishOptions =
  | {
      type: "fanout";
      exchange: string;
      data: string;
    }
  | {
      type: "headers";
      exchange: string;
      headers: { "x-match": "all" | "any"; [index: string]: string };
      data: string;
    }
  | {
      type: "direct" | "topic";
      exchange: string;
      routingKey: string;
      data: string;
    };

type ConsumeQueue = {
  queue: string;
  callback: (
    msg: amqplib.ConsumeMessage,
    channel: amqplib.Channel
  ) => Promise<void>;
};

type ConsumeExchange =
  | {
      type: "fanout";
      exchange: string;
      queue?: string;
      callback: (
        msg: amqplib.ConsumeMessage,
        channel: amqplib.Channel
      ) => Promise<void>;
    }
  | {
      type: "headers";
      exchange: string;
      queue?: string;
      headers: Record<string, string>;
      callback: (
        msg: amqplib.ConsumeMessage,
        channel: amqplib.Channel
      ) => Promise<void>;
    }
  | {
      type: "direct" | "topic";
      exchange: string;
      queue?: string;
      routingKey: string;
      callback: (
        msg: amqplib.ConsumeMessage,
        channel: amqplib.Channel
      ) => Promise<void>;
    };

type ConsumeType = ConsumeQueue | ConsumeExchange;

type QueueConfig =
  | {
      queue: string;
      options?: amqplib.Options.AssertQueue;
    }
  | {
      type: "direct" | "topic";
      exchange: string;
      queue?: string;
      routingKey: string;
      options?: amqplib.Options.AssertQueue;
    }
  | {
      type: "headers";
      exchange: string;
      queue?: string;
      headers: Record<string, string>;
      options?: amqplib.Options.AssertQueue;
    }
  | {
      type: "fanout";
      exchange: string;
      queue?: string;
      options?: amqplib.Options.AssertQueue;
    };

export interface ExchangeConfig {
  name: string;
  type: "direct" | "topic" | "fanout" | "headers";
  options?: amqplib.Options.AssertExchange;
}

interface AMQPPluginOptions extends FastifyPluginOptions {
  connectConfig: string | amqplib.Options.Connect;
  exchanges?: ExchangeConfig[];
  queues?: QueueConfig[];
}

async function amqp(fastify: FastifyInstance, options: AMQPPluginOptions) {
  const { connectConfig, exchanges = [], queues = [] } = options;
  const connect = await amqplib.connect(
    connectConfig
    // {
    //   username: "root",
    //   password: "secret",
    //   hostname: "localhost",
    //   port: 5672,
    //   vhost: "queue",
    //   frameMax: 131072,
    // }
    // "amqp://root:secret@localhost:5672/queue?frameMax=131072"
  );

  async function sendToQueue(queue: string, data: string) {
    const channel = await connect.createChannel();
    await channel.assertQueue(queue, {
      durable: true,
    });
    channel.sendToQueue(queue, Buffer.from(data), {
      persistent: true,
    });
    await channel.close();
  }

  async function publish(options: PublishOptions): Promise<void> {
    const { type, exchange, data } = options;
    const channel = await connect.createChannel();

    await channel.assertExchange(exchange, type, { durable: true });

    switch (type) {
      case "fanout": {
        channel.publish(exchange, "", Buffer.from(data), {
          persistent: true,
        });
        break;
      }
      case "headers": {
        const { headers } = options;
        channel.publish(exchange, "", Buffer.from(data), {
          persistent: true,
          headers,
        });
        break;
      }
      case "direct":
      case "topic": {
        const { routingKey } = options;
        channel.publish(exchange, routingKey, Buffer.from(data), {
          persistent: true,
        });
        break;
      }
    }

    await channel.close();
  }

  async function consume(options: ConsumeType): Promise<void> {
    const channel = await connect.createChannel();

    // Case 1: consume queue trực tiếp
    if ("queue" in options && !("type" in options)) {
      await channel.assertQueue(options.queue, { durable: true });
      await channel.consume(options.queue, async (msg) => {
        if (msg) {
          await options.callback(msg, channel);
          channel.ack(msg);
        }
      });
      return;
    }

    // Case 2: consume qua exchange
    const { type, exchange, callback } = options;
    await channel.assertExchange(exchange, type, { durable: true });

    // queue tự đặt hoặc random
    const q = options.queue
      ? await channel.assertQueue(options.queue, { durable: true })
      : await channel.assertQueue("", { exclusive: true });

    if (type === "fanout") {
      await channel.bindQueue(q.queue, exchange, "");
    } else if (type === "headers") {
      await channel.bindQueue(q.queue, exchange, "", options.headers);
    } else {
      await channel.bindQueue(q.queue, exchange, options.routingKey);
    }

    await channel.consume(q.queue, async (msg) => {
      if (msg) {
        await callback(msg, channel);
        channel.ack(msg);
      }
    });
  }
  console.log(exchanges);
  console.log(queues);

  fastify.get("/test", async (req: FastifyRequest, reply: FastifyReply) => {});

  //   conn.on("close", () => {
  //     console.log("first");
  //   });
}

export default fp(amqp, {
  name: "amqpPlugin",
});
