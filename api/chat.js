import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../lib/knowledge.js";

// Con ANTHROPIC_API_KEY se llama directo a la API de Anthropic. Sin ella, se usa
// Vercel AI Gateway con la credencial OIDC del propio despliegue (no hace falta clave).
const GATEWAY_URL = process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh";
const DIRECT = Boolean(process.env.ANTHROPIC_API_KEY);
// Sonnet 5.5: el modelo balanceado (capacidad y costo) para un chat de preguntas frecuentes.
const MODEL = process.env.KERMESSE_MODEL || (DIRECT ? "claude-sonnet-5-5" : "anthropic/claude-sonnet-5.5");
const MAX_TURNS = 20;
const MAX_CHARS = 2000;
const RATE_LIMIT = 20; // mensajes por minuto por IP (por instancia)
const hits = new Map();
const directClient = DIRECT ? new Anthropic() : null;

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

// En Vercel Functions el token OIDC llega en cada petición, así que el cliente del gateway se crea por petición.
function gatewayClient(req) {
  const token = process.env.AI_GATEWAY_API_KEY || req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN;
  return token ? new Anthropic({ apiKey: token, baseURL: GATEWAY_URL }) : null;
}

function params(messages, maxTokens, withEffort) {
  return {
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    ...(withEffort ? { output_config: { effort: "low" } } : {}),
    messages,
  };
}

// Abre el stream con la configuración preferida; si el proveedor rechaza `effort`, reintenta sin él.
async function openStream(client, messages, maxTokens) {
  let withEffort = true;
  for (;;) {
    const p = params(messages, maxTokens, withEffort);
    const stream = DIRECT
      ? client.beta.messages.stream({ ...p, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : client.messages.stream(p);
    const it = stream[Symbol.asyncIterator]();
    try {
      const first = await it.next();
      return { stream, it, first, withEffort };
    } catch (err) {
      if (withEffort && err instanceof Anthropic.BadRequestError) {
        console.warn("Reintentando sin output_config:", err.message);
        withEffort = false;
        continue;
      }
      throw err;
    }
  }
}

// Deja solo turnos user/assistant de texto, alternados y empezando por el usuario.
function sanitize(raw) {
  if (!Array.isArray(raw)) return null;
  const messages = [];
  for (const m of raw.slice(-MAX_TURNS)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.content !== "string" || !m.content.trim()) continue;
    const content = m.content.slice(0, MAX_CHARS);
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content += "\n" + content;
    else messages.push({ role: m.role, content });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

// GET /api/chat?ping=1 comprueba de punta a punta que el modelo responde.
async function ping(req, res) {
  const client = DIRECT ? directClient : gatewayClient(req);
  const info = { provider: DIRECT ? "anthropic" : "ai-gateway", model: MODEL, credential: Boolean(client) };
  if (!client) return res.status(503).json({ ok: false, ...info, error: "Sin credencial: falta ANTHROPIC_API_KEY o el token OIDC de Vercel." });
  // ?ping=models lista qué modelos de Claude puede usar este equipo en AI Gateway.
  if (req.query.ping === "models" && !DIRECT) {
    const r = await fetch(`${GATEWAY_URL}/v1/models?include_availability`, { headers: { Authorization: `Bearer ${client.apiKey}` } });
    const body = await r.json().catch(() => ({}));
    const models = (body.data || [])
      .filter((m) => /^anthropic\/claude-[a-z]+-[\d.]+$/.test(m.id))
      .map((m) => ({ id: m.id, status: m.model_eligibility?.status, reason: m.model_eligibility?.reason ?? null }));
    return res.status(r.status).json({ ...info, account: body.request_context_availability ?? null, models });
  }
  // ?ping=ask&q=... hace una pregunta completa con la base de conocimiento (para pruebas).
  const asking = req.query.ping === "ask" && typeof req.query.q === "string";
  const question = asking ? req.query.q.slice(0, MAX_CHARS) : "Responde solo con la palabra: listo";
  const started = Date.now();
  try {
    const { stream, it, first, withEffort } = await openStream(client, [{ role: "user", content: question }], asking ? 4096 : 64);
    if (!first.done) for (let r = await it.next(); !r.done; r = await it.next());
    const final = await stream.finalMessage();
    const text = final.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return res.status(200).json({
      ok: true, ...info, effort: withEffort ? "low" : "default", ms: Date.now() - started,
      stop_reason: final.stop_reason, usage: final.usage, reply: text,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, ...info, status: err.status ?? null, error: String(err.message || err).slice(0, 500) });
  }
}

export default async function handler(req, res) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();

  if (req.method === "GET" && req.query?.ping) {
    if (rateLimited(ip)) return res.status(429).json({ ok: false, error: "Demasiadas comprobaciones seguidas." });
    return ping(req, res);
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Demasiadas preguntas seguidas. Espera un momento e intenta de nuevo." });
  }

  const messages = sanitize(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: "Mensaje inválido." });
  }

  const client = DIRECT ? directClient : gatewayClient(req);
  if (!client) {
    console.error("Sin credencial para el modelo (ANTHROPIC_API_KEY u OIDC).");
    return res.status(503).json({ error: "El asistente no está disponible en este momento." });
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });

  try {
    const { stream, it, first } = await openStream(client, messages, 4096);
    for (let r = first; !r.done; r = await it.next()) {
      const event = r.value;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(event.delta.text);
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      res.write("\n\nNo puedo ayudarte con eso, pero con gusto respondo cualquier pregunta sobre la Kermesse Sergista.");
    }
  } catch (err) {
    console.error("Error llamando a Claude:", err);
    const msg =
      err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError
        ? "Hay mucha demanda en este momento. Intenta de nuevo en unos segundos."
        : "No fue posible responder en este momento. Intenta de nuevo.";
    res.write("\n\n" + msg);
  }
  res.end();
}
