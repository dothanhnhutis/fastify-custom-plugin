import Fastify from "fastify";
import postgresDBPlugin from "./plugins/db";
import amqpPlugin from "./plugins/amqp";
import { errorHandler } from "./error-handler";
export async function buildServer() {
  const fastify = Fastify({
    logger: false,
    trustProxy: true,
  });

  await fastify.register(postgresDBPlugin);
  await fastify.register(amqpPlugin, {
    connectConfig: {
      username: "root",
      password: "secret",
      hostname: "localhost",
      port: 5672,
      vhost: "queue",
      frameMax: 131072,
    },
    exchanges: [
      {
        name: "exchange-fanout",
        type: "fanout",
        options: {
          durable: true,
        },
      },
      {
        name: "exchange-headers",
        type: "headers",
        options: {
          durable: true,
        },
      },
    ],
    queues: [
      {
        type: "queue",
        name: "test-queue",
        options: { durable: true },
      },
      {
        type: "fanout",
        name: "queue-exchange-fanout",
        exchange: "exchange-fanout",
        options: { durable: true },
      },
      {
        type: "headers",
        name: "queue-exchange-headers-any",
        exchange: "exchange-headers",
        options: { durable: true },
        headers: {
          "x-match": "any",
          "x-error": "1",
          "x-warning": "2",
        },
      },
      {
        type: "headers",
        name: "queue-exchange-headers-all",
        exchange: "exchange-headers",
        options: { durable: true },
        headers: {
          "x-match": "all",
          "x-text": "123",
          "x-ok": "456",
        },
      },
    ],
    consumes: [
      {
        queue: "test-queue",
        callback: (msg, channel) => {
          console.log("test-queue", msg.content.toString());
          channel.ack(msg);
        },
      },
      {
        queue: "queue-exchange-fanout",
        callback(msg, channel) {
          console.log("queue-exchange-fanout", msg.content.toString());
          channel.ack(msg);
        },
      },
      {
        queue: "queue-exchange-headers-any",
        callback(msg, channel) {
          console.log("queue-exchange-headers-any", msg.content.toString());
          channel.ack(msg);
        },
      },
      {
        queue: "queue-exchange-headers-all",
        callback(msg, channel) {
          console.log("queue-exchange-headers-all", msg.content.toString());
          channel.ack(msg);
        },
      },
    ],
  });

  // fastify.setErrorHandler(errorHandler);

  return fastify;
}
