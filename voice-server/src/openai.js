import WebSocket from "ws";
import { EventEmitter } from "events";

const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-mini-realtime";

// Cliente minimalista del OpenAI Realtime API sobre WebSocket.
// Eventos emitidos:
//   "session.ready"            sesion configurada y lista
//   "audio.delta" (base64)     audio de salida (g711_ulaw) para Twilio
//   "speech_started"           el usuario empezo a hablar (para enviar "clear" a Twilio)
//   "transcript.assistant"     texto de una respuesta completa de la IA
//   "transcript.user"          transcripcion de lo que dijo el usuario
//   "response.done" (texto)    respuesta completa (texto acumulado del turno)
//   "error", "close"
export class OpenAIRealtime extends EventEmitter {
  constructor({ instructions }) {
    super();
    this.instructions = instructions;
    this.ws = null;
    this.ready = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      });

      const timeout = setTimeout(() => reject(new Error("Timeout conectando a OpenAI")), 20000);

      this.ws.on("open", () => this.sendSessionUpdate());
      this.ws.on("message", (raw) => this.onMessage(raw));
      this.ws.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });
      this.ws.on("close", () => {
        this.ready = false;
        this.emit("close");
      });

      this.once("session.ready", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  sendSessionUpdate() {
    this.send({
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions: this.instructions,
        voice: process.env.OPENAI_VOICE || "alloy",
        // Twilio Media Streams envia/recibe g711_ulaw a 8kHz
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
        },
        include: ["response.output_audio.transcript"],
      },
    });
  }

  onMessage(raw) {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (event.type) {
      case "session.updated":
        this.ready = true;
        this.emit("session.ready");
        break;
      case "response.output_audio.delta":
        this.emit("audio.delta", event.delta);
        break;
      case "input_audio_buffer.speech_started":
        this.emit("speech_started");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) this.emit("transcript.user", event.transcript);
        break;
      case "response.done": {
        const output = event.response?.output ?? [];
        const texts = output
          .flatMap((item) => item.content ?? [])
          .map((c) => (c.type === "audio" || c.type === "text" ? c.transcript ?? c.text ?? "" : ""))
          .filter(Boolean);
        const full = texts.join(" ");
        if (full) this.emit("transcript.assistant", full);
        this.emit("response.done", full);
        break;
      }
      case "error":
        this.emit("error", new Error(event.error?.message ?? "Error desconocido de OpenAI"));
        break;
    }
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}
