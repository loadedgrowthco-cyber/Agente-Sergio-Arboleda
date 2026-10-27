// Servidor local para probar sin Vercel: `npm run dev` y abre http://localhost:3000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import handler from "./api/chat.js";

const PUBLIC = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };

  const url = new URL(req.url, "http://localhost");
  req.query = Object.fromEntries(url.searchParams);
  if (url.pathname === "/api/chat") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
    return handler(req, res);
  }

  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const file = await readFile(join(PUBLIC, normalize(path).replace(/^(\.\.[/\\])+/, "")));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404).end("No encontrado");
  }
}).listen(process.env.PORT || 3000, () => console.log("Asistente Kermesse en http://localhost:" + (process.env.PORT || 3000)));
