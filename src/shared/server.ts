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
    // "amqp://root:secret@localhost:5672/queue?frameMax=131072"

    exchanges: [
      // {
      //   type: "topic",
      //   name: "",
      //   options: {},
      // },
    ],
    queues: [],
  });

  // fastify.setErrorHandler(errorHandler);

  return fastify;
}
