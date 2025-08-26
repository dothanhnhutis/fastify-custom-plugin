import amqplib from "amqplib";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";

type Consume = {
  queue: string;
  callback: (msg: amqplib.ConsumeMessage, channel: amqplib.Channel) => void;
  options?: amqplib.Options.Consume;
};

interface AMQPConnect extends amqplib.Options.Connect {
  maxRetries?: number;
  retryDelay?: number;
  clientProperties?: Record<string, string>;
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

interface AMQPOptions {
  connectConfig: AMQPConnect;
  exchanges?: ExchangeConfig[];
  queues?: QueueConfig[];
  prefetch?: number;
  consumes?: Consume[];
}

export class AMQP {
  private connectConfig: AMQPConnect;
  private _connection: amqplib.ChannelModel | null = null;

  constructor(options: AMQPOptions) {
    this.connectConfig = options.connectConfig;
  }

  get connection(): amqplib.ChannelModel {
    if (!this.connection) throw new Error("RabbitMQ - connection closed");
    return this.connection;
  }

  async connect() {
    if (this._connection) return;

    const {
      maxRetries = 0,
      retryDelay = 3000,
      ...connectConfig
    } = this.connectConfig;

    try {
      this._connection = await amqplib.connect(connectConfig, {
        clientProperties: {
          connection_name: "publisher-connection",
          purpose: "publishing",
        },
      });
      console.log("RabbitMQ - connect success");

      this._connection.on("close", () => {
        console.log("RabbitMQ - stream connection break");
        this._connection = null;

        const retry = maxRetries <= 0 ? 0 : maxRetries;
        const delay = retryDelay <= 0 ? 3000 : retryDelay;
        if (retry <= 0) {
          console.log("RabbitMQ - server down");
        } else {
          console.log("RabbitMQ - start retry connect");
          this.reconnect(retry, delay);
        }
      });
      console.log("bindConsumers");
    } catch (error: unknown) {
      throw new Error("RabbitMQ connect Error: ");
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async reconnect(maxRetries: number, retryDelay: number) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `RabbitMQ - thu ket noi lai lan thu ${attempt} sau ${retryDelay}ms, retring...`
        );
        await this.sleep(retryDelay);
        await this.connect();
        break;
      } catch (error) {
        console.log(`RabbitMQ - thu ket noi lai lan thu ${attempt} that bai`);
        if (attempt == maxRetries)
          console.log(`RabbitMQ - đã hết số lần thử kết nối lại.`);
      }
    }
  }

  private async bindConsumers() {}

  private async createChannel(options: {
    exchanges?: ExchangeConfig[];
    queues?: QueueConfig[];
  }): Promise<amqplib.Channel> {
    const { exchanges = [], queues = [] } = options;
    const channel = await this.connection.createChannel();

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

interface AMQPConnectConfig extends amqplib.Options.Connect {
  name: string;
  maxRetries?: number;
  retryDelay?: number;
  clientProperties?: Record<string, string>;
}

interface AMQPConnectionPoolOptions {
  connections?: {
    name: string;
    maxRetries?: number;
    retryDelay?: number;
    clientProperties?: Partial<{
      connection_name: string;
      purpose: string;
    }>;
    // config?: amqplib.Options.Connect;
    channels?: {
      name: string;
      confirmSelect?: boolean;
      prefetch?: number;
    }[];
  }[];
  config: amqplib.Options.Connect;
  exchanges?: ExchangeConfig[];
  queues?: QueueConfig[];
}

class AMQPConnectionPool {
  private connections: Map<string, amqplib.ChannelModel> = new Map();
  private channels: Map<string, amqplib.Channel | amqplib.ConfirmChannel> =
    new Map();
  private options: AMQPConnectionPoolOptions;

  constructor(options: AMQPConnectionPoolOptions) {
    this.options = options;
  }

  async connect() {
    if (!this.options.connections) return;
    try {
      for (let connection of this.options.connections) {
        const {
          maxRetries = 0,
          retryDelay = 5000,
          clientProperties,
          name,
          channels = [],
        } = connection;

        const conn = await amqplib.connect(this.options.config, {
          clientProperties,
        });

        // conn.on("error", (error) => {
        //   console.error(`❌ Connection error (${name}):`, error);
        //   // this.handleConnectionFailure(name);
        // });

        // conn.on("close", () => {
        //   console.log("RabbitMQ - stream connection break");

        //   const retry = maxRetries <= 0 ? 0 : maxRetries;
        //   const delay = retryDelay <= 0 ? 3000 : retryDelay;
        //   if (retry <= 0) {
        //     console.log("RabbitMQ - server down");
        //   } else {
        //     console.log("RabbitMQ - start retry connect");
        //     // this.reconnect(retry, delay);
        //   }
        // });

        this.connections.set(name, conn);

        for (let ch of channels) {
          let channel: amqplib.Channel | amqplib.ConfirmChannel;
          if (ch.confirmSelect) {
            channel = await conn.createConfirmChannel();
          } else {
            channel = await conn.createChannel();
          }

          if (ch.prefetch && ch.prefetch > 0) {
            await channel.prefetch(ch.prefetch);
          }
          this.channels.set(ch.name, channel);
        }
      }
      this.setupQueuesAndExchanges();

      console.log("RabbitMQ connect success");

      // this.setupConnectionErrorHandling();
    } catch (error) {
      this.closeAll();
      throw new Error("RabbitMQ connect Error: ");
    }
  }

  private async setupQueuesAndExchanges() {
    const conn = await amqplib.connect(this.options.config);
    const channel = await conn.createChannel();
    const { queues = [], exchanges = [] } = this.options;

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

    await channel.close();
    await conn.close();
  }

  private async createChannel() {}

  private setupConnectionErrorHandling() {
    this.connections.forEach((connection, name) => {
      connection.on("error", (error) => {
        console.error(`❌ Connection error (${name}):`, error);
        // this.handleConnectionFailure(name);
      });

      connection.on("close", () => {
        console.log(`🔐 Connection closed: ${name}`);
        // this.handleConnectionFailure(name);

        //  this.reconnect()
      });
    });
  }

  private async closeAll() {
    console.log("🛑 Closing connection pool...");

    // Close all channels first
    await Promise.all(
      Array.from(this.channels.values()).map((channel) =>
        channel
          .close()
          .catch((err) => console.error("Channel close error:", err))
      )
    );

    // Close all connections
    await Promise.all(
      Array.from(this.connections.values()).map((connection) =>
        connection
          .close()
          .catch((err) => console.error("Connection close error:", err))
      )
    );

    this.channels.clear();
    this.connections.clear();

    console.log("✅ Connection pool closed");
  }

  async reconnect() {}

  // Stats & monitoring
  // getPoolStats() {
  //   return {
  //     connections: {
  //       total: this.connections.size,
  //       active: Array.from(this.connections.entries()).map(([name, conn]) => ({
  //         name,
  //         status: conn.connection.expectSocketClose ? "closed" : "open",
  //       })),
  //     },
  //     channels: {
  //       total: this.channels.size,
  //       active: Array.from(this.channels.keys()),
  //     },
  //   };
  // }
}

const a = new AMQPConnectionPool({
  config: {
    username: "root",
    password: "secret",
    hostname: "localhost",
    port: 5672,
    vhost: "queue",
    frameMax: 131072,
  },
  connections: [
    {
      name: "publisher-connection",
      maxRetries: 5,
      retryDelay: 5000,
      clientProperties: {
        connection_name: "publisher-connection",
        purpose: "publishing",
      },
      channels: [
        {
          name: "order-publisher",
          confirmSelect: true,
        },
      ],
    },
    {
      name: "consume-connection",
      maxRetries: 5,
      retryDelay: 5000,
      clientProperties: {
        connection_name: "consume-connection",
        purpose: "consuming",
      },
      channels: [
        {
          name: "order-consumer",
          prefetch: 100,
        },
      ],
    },
  ],
  exchanges: [
    {
      name: "exchange-fanout",
      type: "fanout",
      options: {
        durable: true,
      },
    },
  ],
});

a.connect();
