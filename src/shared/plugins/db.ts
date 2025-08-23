import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
  Pool,
  PoolClient,
  PoolConfig,
  QueryConfig,
  QueryResultRow,
  QueryResult,
} from "pg";

declare module "fastify" {
  interface FastifyInstance {
    db: PostgeSQL;
    query: <R extends QueryResultRow = any, I = any[]>(
      queryConfig: QueryConfig<I>,
      options?: QueryOptions
    ) => Promise<QueryResult<R>>;
    transaction: (
      callback: (client: PoolClient) => Promise<void>,
      options?: QueryOptions
    ) => Promise<void>;
  }
}

interface QueryOptions {
  maxRetries?: number;
  retryDelay?: number;
}

class PostgeSQL {
  private pool: Pool;
  constructor(config: PoolConfig) {
    this.pool = new Pool({
      connectionString:
        "postgres://admin:secret@localhost:5432/pgdb?schema=publish",
      max: 100,
      idleTimeoutMillis: 30_000,
      ...config,
    });
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async query<R extends QueryResultRow = any, I = any[]>(
    queryConfig: QueryConfig<I>,
    options?: QueryOptions
  ): Promise<QueryResult<R>> {
    try {
      const result = await this.pool.query<R, I>(queryConfig);
      return result;
    } catch (error: unknown) {
      let err = error;
      console.log(`Query failed:`, error);
      if (options && options.maxRetries && options.maxRetries > 0) {
        const delay: number =
          options.retryDelay && options.retryDelay > 0
            ? options.retryDelay
            : 1000;
        for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
          try {
            console.log(`Query attempt ${attempt}, retrying...`);
            await this.sleep(delay);
            const result = await this.pool.query<R, I>(queryConfig);
            console.log(`Query attempt ${attempt} success`);
            return result;
          } catch (retryErr: unknown) {
            console.log(`Query attempt ${attempt} failed:`, retryErr);
            err = retryErr;
          }
        }
      }
      throw err;
    }
  }

  public async transaction(
    callback: (client: PoolClient) => Promise<void>,
    options?: QueryOptions
  ): Promise<void> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      await callback(client);
      await client.query("COMMIT");
    } catch (error: unknown) {
      if (client) await client.query("ROLLBACK");
      let err = error;
      console.log(`transaction failed:`, error);
      if (options && options.maxRetries && options.maxRetries > 0) {
        const delay: number =
          options.retryDelay && options.retryDelay > 0
            ? options.retryDelay
            : 1000;
        for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
          try {
            console.log(`transaction attempt ${attempt}, retrying...`);
            await this.sleep(delay);
            client = await this.pool.connect();
            await callback(client);
            await client.query("COMMIT");
            console.log(`transaction attempt ${attempt} success`);
          } catch (retryErr: unknown) {
            if (client) await client.query("ROLLBACK");
            console.log(`transaction attempt ${attempt} failed:`, retryErr);
            err = retryErr;
          }
        }
      }
      throw err;
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  public async healthCheck() {
    try {
      const start = Date.now();
      await this.pool.query("SELECT 1 as health");
      const duration = Date.now() - start;

      return {
        status: "healthy",
        responseTime: `${duration}ms`,
        timestamp: new Date().toISOString(),
        pool: {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount,
        },
      };
    } catch (error: unknown) {
      return {
        status: "unhealthy",
        error: (error as any).message,
        timestamp: new Date().toISOString(),
        pool: {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount,
        },
      };
    }
  }

  async close() {
    console.log("Closing database connections...");

    if (this.pool) {
      await this.pool.end();
      console.log("Database connections closed");
    }
  }

  get poolStats() {
    return this.pool
      ? {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount,
        }
      : null;
  }
}

export interface PostgresDBOptions extends PoolConfig {}

async function postgresDB(
  fastify: FastifyInstance,
  options: PostgresDBOptions
) {
  const dbManager = new PostgeSQL({
    connectionString:
      "postgres://admin:secret@localhost:5432/pgdb?schema=publish",
    max: 100,
    idleTimeoutMillis: 30_000,
    ...options,
  });

  fastify.decorate("db", dbManager);

  fastify.decorate(
    "query",
    async <R extends QueryResultRow = any, I = any[]>(
      queryConfig: QueryConfig<I>,
      options?: QueryOptions
    ) => {
      return await dbManager.query<R, I>(queryConfig, options);
    }
  );

  // Add transaction method
  fastify.decorate(
    "transaction",
    async (
      callback: (client: PoolClient) => Promise<void>,
      options?: QueryOptions
    ) => {
      return await dbManager.transaction(callback, options);
    }
  );

  // fastify.addHook("onReady", async () => {
  //   try {
  //     fastify.logger.info("PostgreSQL - Database connected successfully");
  //   } catch (error) {
  //     isConnected = false;
  //     fastify.logger.error(
  //       "PostgreSQL - Database temporarily unavailable. Please try again in a few moments"
  //     );
  //     throw new CustomError({
  //       message:
  //         "PostgreSQL - Database temporarily unavailable. Please try again in a few moments",
  //       statusCode: StatusCodes.SERVICE_UNAVAILABLE,
  //       statusText: "SERVICE_UNAVAILABLE",
  //     });
  //   }
  // });

  fastify.addHook("onClose", async (instance) => {
    await dbManager.close();
  });

  fastify.get("/healthy/db", async (req, reply) => {
    const health = await dbManager.healthCheck();
    const statusCode = health.status === "healthy" ? 200 : 503;
    reply.code(statusCode).send(health);
  });

  fastify.get("/test-db", async (req, reply) => {
    const a = await fastify.query({
      text: "select * from users",
    });
    console.log(a);
    reply.code(200).send("ok");
  });
}

export default fp(postgresDB, {
  name: "postgresDBPlugin",
});
