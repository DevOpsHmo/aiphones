import WebSocket from "ws";
import {
  fetchActiveProducts,
  upsertCustomer,
  insertOrder,
  saveCall,
} from "./db.js";
import { buildInstructions } from "./prompt.js";
import { OpenAIRealtime } from "./openai.js";
import { buildOrderItems } from "./orders.js";
import { sendWhatsAppConfirmation } from "./whatsapp.js";

// Maneja la conexion WebSocket de Twilio para UNA llamada:
// Twilio <-> este servidor <-> OpenAI Realtime API.
export function handleTwilioConnection(twilioWs) {
  const session = new CallSession(twilioWs);
  twilioWs.on("message", (raw) => session.onTwilioMessage(raw));
  twilioWs.on("close", () => session.finish("twilio-closed"));
  twilioWs.on("error", (err) => {
    console.error("[twilio] error de websocket:", err.message);
    session.finish("twilio-error");
  });
}

class CallSession {
  constructor(twilioWs) {
    this.twilioWs = twilioWs;
    this.streamSid = null;
    this.callSid = "";
    this.from = "";
    this.to = "";
    this.startedAt = Date.now();
    this.openai = null;
    this.closed = false;
    this.orderCreated = false;
    this.orderId = null;
    this.assistantTranscript = [];
    this.userTranscript = [];
  }

  onTwilioMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.event === "start") return this.onStart(msg.start);
    if (msg.event === "media") return this.onMedia(msg.media);
    if (msg.event === "stop") return this.finish("twilio-stop");
  }

  async onStart(start) {
    this.streamSid = start.streamSid;
    this.callSid = start.customParameters?.call_sid ?? start.callSid ?? "";
    this.from = start.customParameters?.from ?? "";
    this.to = start.customParameters?.to ?? "";
    this.startedAt = Date.now();
    console.log(`[call] inicio ${this.callSid} from=${this.from}`);

    try {
      const products = await fetchActiveProducts();
      await this.connectOpenAI(products);
      // Saludo inicial: la IA inicia la conversacion.
      this.openai.send({ type: "response.create" });
    } catch (err) {
      console.error("[call] no se pudo iniciar la sesion de IA:", err.message);
      this.finish("openai-start-failed");
    }
  }

  connectOpenAI(products) {
    const ai = new OpenAIRealtime({ instructions: buildInstructions(products) });
    this.openai = ai;

    ai.on("audio.delta", (delta) =>
      this.sendTwilio({ event: "media", streamSid: this.streamSid, media: { payload: delta } })
    );
    // Si el usuario interrumpe a la IA, limpiamos el audio pendiente en Twilio.
    ai.on("speech_started", () =>
      this.sendTwilio({ event: "clear", streamSid: this.streamSid })
    );
    ai.on("transcript.assistant", (t) => this.assistantTranscript.push(t));
    ai.on("transcript.user", (t) => this.userTranscript.push(t));
    ai.on("response.done", (text) => this.onAiResponse(text));
    ai.on("error", (err) => console.error("[openai]", err.message));
    ai.on("close", () => {
      if (!this.closed) this.finish("openai-closed");
    });

    return ai.connect();
  }

  async onAiResponse(text) {
    if (this.orderCreated) return;
    const orderJson = extractOrderJson(text);
    if (!orderJson) return;

    try {
      await this.createOrder(orderJson);
    } catch (err) {
      console.error("[call] fallo la creacion del pedido:", err.message);
    }
    // Pedido tomado: colgar. Cerrar el stream finaliza el <Connect> de Twilio
    // y termina la llamada.
    this.finish("order-complete");
  }

  async createOrder(orderJson) {
    const orderType = orderJson.order_type === "delivery" ? "delivery" : "pickup";
    const address = orderType === "delivery" ? orderJson.address ?? null : null;

    const products = await fetchActiveProducts();
    const { items, total } = buildOrderItems(products, orderJson.items ?? []);
    if (items.length === 0) throw new Error("El JSON no contiene productos");
    if (items.some((it) => it.product_id === null)) {
      console.warn("[call] hay productos que no coinciden con el menu:", items.filter((i) => !i.product_id));
    }

    const customer = await upsertCustomer({
      phone: this.from,
      name: orderJson.customer_name ?? null,
      address,
    });

    const order = await insertOrder({
      customerId: customer.id,
      items,
      total,
      orderType,
      address,
    });

    this.orderCreated = true;
    this.orderId = order.id;
    console.log(`[call] pedido creado ${order.id} total=${total}`);

    try {
      await sendWhatsAppConfirmation({ to: this.from, orderId: order.id, total });
    } catch (err) {
      console.error("[whatsapp] fallo el envio:", err.message);
    }
  }

  onMedia(media) {
    if (this.openai?.ready) {
      this.openai.send({ type: "input_audio_buffer.append", audio: media.payload });
    }
  }

  sendTwilio(obj) {
    if (this.twilioWs.readyState === WebSocket.OPEN) {
      this.twilioWs.send(JSON.stringify(obj));
    }
  }

  async finish(reason) {
    if (this.closed) return;
    this.closed = true;

    const duration = Math.round((Date.now() - this.startedAt) / 1000);
    const transcript = [
      ...this.userTranscript.map((t) => `Cliente: ${t}`),
      ...this.assistantTranscript.map((t) => `IA: ${t}`),
    ].join("\n");

    console.log(`[call] fin ${this.callSid} razon=${reason} duracion=${duration}s pedido=${this.orderId ?? "ninguno"}`);

    try {
      await saveCall({
        callSid: this.callSid,
        from: this.from,
        to: this.to,
        duration,
        transcript: transcript || null,
        orderId: this.orderId,
      });
    } catch (err) {
      console.error("[db] no se pudo guardar la llamada:", err.message);
    }

    try {
      this.openai?.close();
    } catch {}
    try {
      this.twilioWs.close();
    } catch {}
  }
}

// Extrae el JSON del pedido del texto de la IA (su ultimo mensaje).
function extractOrderJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}
