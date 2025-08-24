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
      {
        name: "exchange-direct",
        type: "direct",
        options: {
          durable: true,
        },
      },
      {
        name: "exchange-topic",
        type: "topic",
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
          error: "1",
          warning: "2",
        },
      },
      {
        type: "headers",
        name: "queue-exchange-headers-all",
        exchange: "exchange-headers",
        options: { durable: true },
        headers: {
          "x-match": "all",
          text: "123",
          ok: "456",
        },
      },
      {
        type: "direct",
        name: "queue-exchange-direct-error",
        exchange: "exchange-direct",
        routingKey: "error",
        options: { durable: true },
      },
      {
        type: "direct",
        name: "queue-exchange-direct-warning",
        exchange: "exchange-direct",
        routingKey: "warning",
        options: { durable: true },
      },
      {
        type: "direct",
        name: "queue-exchange-direct-info",
        exchange: "exchange-direct",
        routingKey: "info",
        options: { durable: true },
      },
      {
        type: "topic",
        name: "queue-exchange-topic-1",
        exchange: "exchange-topic",
        routingKey: "*.orange.*",
        options: { durable: true },
      },
      {
        type: "topic",
        name: "queue-exchange-topic-2",
        exchange: "exchange-topic",
        routingKey: "*.*.rabbit",
        options: { durable: true },
      },
      {
        type: "topic",
        name: "queue-exchange-topic-2",
        exchange: "exchange-topic",
        routingKey: "lazy.#",
        options: { durable: true },
      },
      {
        type: "topic",
        name: "queue-exchange-topic-3",
        exchange: "exchange-topic",
        routingKey: "lazy.#",
        options: { durable: true },
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
      {
        queue: "queue-exchange-direct-error",
        callback(msg, channel) {
          console.log("queue-exchange-direct-error", msg.content.toString());
          channel.ack(msg);
        },
      },
      {
        queue: "queue-exchange-direct-warning",
        callback(msg, channel) {
          console.log("queue-exchange-direct-warning", msg.content.toString());
          channel.ack(msg);
        },
      },
      {
        queue: "queue-exchange-direct-info",
        callback(msg, channel) {
          console.log("queue-exchange-direct-info", msg.content.toString());
          channel.ack(msg);
        },
      },
      {
        queue: "queue-exchange-topic-1",
        callback(msg, channel) {
          console.log("queue-exchange-topic-1", msg.content.toString());
          channel.ack(msg);
        },
      },
      {
        queue: "queue-exchange-topic-2",
        callback(msg, channel) {
          console.log("queue-exchange-topic-2", msg.content.toString());
          channel.ack(msg);
        },
      },
      {
        queue: "queue-exchange-topic-3",
        callback(msg, channel) {
          console.log("queue-exchange-topic-3", msg.content.toString());
          channel.ack(msg);
        },
      },
    ],
  });

  // await fastify.register(amqpPlugin);

  // fastify.setErrorHandler(errorHandler);

  return fastify;
}
