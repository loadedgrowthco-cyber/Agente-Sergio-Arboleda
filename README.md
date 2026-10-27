# Asistente Kermesse

Agente de IA de la **Kermesse Sergista 2026**, feria de emprendimiento de la Universidad Sergio Arboleda, sede Barranquilla (jueves 29 de octubre, 7:00 a. m. – 6:00 p. m.).
Los visitantes escanean un QR, abren el chat en el celular y le hacen preguntas sobre la feria. Funciona con Claude (Anthropic). Misma base técnica y diseño que el Asistente Shuk.

## Estructura

| Archivo | Qué hace |
|---|---|
| `lib/knowledge.js` | **Base de conocimiento y system prompt.** Edita aquí lo que sabe el agente. |
| `api/chat.js` | Endpoint `/api/chat`: llama a Claude y devuelve la respuesta en streaming. |
| `public/index.html` | La página de chat (pensada para celular). |
| `public/qr.html` | Página con el código QR para proyectar en una pantalla del stand. |
| `public/stand.html` | Creativos imprimibles del stand: póster A3, hablador de mesa, historia de Instagram y hoja de stickers. |
| `creativos/` | PNG y PDF ya generados de esas piezas, y `TEXTOS-STAND.md` con los textos para el stand y redes. |
| `server.js` | Servidor local para pruebas. |

## Probar en local

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # tu clave de https://console.anthropic.com
npm run dev                          # abre http://localhost:3000
```

## Conexión con Claude

- **Sin configurar nada:** en Vercel el agente usa **Vercel AI Gateway** con la credencial OIDC del propio proyecto (modelo `anthropic/claude-sonnet-5.5`).
- **Con `ANTHROPIC_API_KEY`:** el agente llama directo a la API de Anthropic (`claude-sonnet-5-5`).
- `KERMESSE_MODEL` cambia el modelo en cualquiera de los dos modos.
- Diagnóstico: `GET /api/chat?ping=1`, `?ping=ask&q=tu pregunta` y `?ping=models` (igual que en el Shuk).

## Publicar en Vercel

1. Importa este repositorio en [vercel.com/new](https://vercel.com/new) y pulsa **Deploy**.
2. (Opcional) Agrega `ANTHROPIC_API_KEY` en Environment Variables.
3. En **Settings → Domains** agrega el subdominio (por ejemplo `kermesse.lodeai.tech`) y crea el CNAME en el DNS de lodeai.tech.
4. Abre `https://TU-DOMINIO/stand.html` y pulsa **Imprimir / guardar PDF**: el QR apunta automáticamente a ese dominio. `https://TU-DOMINIO/qr.html` es la versión para proyectar.

> Los archivos de `creativos/` se generaron con el QR apuntando a `https://kermesse.lodeai.tech`. Si usas otro dominio, imprime desde `/stand.html` del dominio real (o usa `/stand.html?url=https://otro-dominio`).

## Antes del evento

- Revisa el saldo de AI Gateway (o pon un límite de gasto si usas tu clave de Anthropic).
- Escanea el QR impreso con dos celulares distintos y haz preguntas de prueba con datos móviles.
- El endpoint limita a 20 mensajes por minuto por persona y recorta los mensajes muy largos.
- Si la organización publica la hora del show central o la música en vivo, agrégala en el Módulo 6 de `lib/knowledge.js` y vuelve a desplegar.
