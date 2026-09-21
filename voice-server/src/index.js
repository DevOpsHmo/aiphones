import "dotenv/config";
import { WebSocketServer } from "ws";
import { handleTwilioConnection } from "./session.js";

const PORT = Number(process.env.PORT || 8080);

// Twilio se conecta a wss://TU_HOST/twilio cuando la llamada entra.
const wss = new WebSocketServer({ port: PORT, path: "/twilio" });

wss.on("connection", (twilioWs, req) => {
  console.log(`[ws] conexion entrante desde ${req.socket.remoteAddress}`);
  handleTwilioConnection(twilioWs);
});

wss.on("error", (err) => {
  console.error("[ws] error del servidor:", err.message);
});

console.log(`[voice-server] escuchando en 0.0.0.0:${PORT}/twilio`);
