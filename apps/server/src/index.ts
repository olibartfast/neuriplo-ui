import { buildServer } from "./app.js";

const app = buildServer();

const port = Number(process.env.PORT ?? 5174);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ port, host });
