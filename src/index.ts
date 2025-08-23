import { buildServer } from "./shared/server";

// Khởi tạo server
async function start(): Promise<void> {
  try {
    const server = await buildServer();

    const port = 4000;
    const host = "0.0.0.0";

    await server.listen({ port, host });

    console.log(`Server started on ${host}:${port}`);
  } catch (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

start();
