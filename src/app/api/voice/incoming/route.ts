import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

export const dynamic = "force-dynamic";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Webhook de Twilio: devuelve TwiML para conectar la llamada a un Media Stream.
export async function POST(request: NextRequest) {
  // Validacion de firma (opcional pero recomendada en produccion)
  const rawBody = await request.text();
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const params = Object.fromEntries(new URLSearchParams(rawBody));
    const signature = request.headers.get("x-twilio-signature") ?? "";
    const valid = twilio.validateRequest(authToken, signature, request.url, params);
    if (!valid) {
      return new NextResponse("Invalid Twilio signature", { status: 403 });
    }
  }

  const params = new URLSearchParams(rawBody);
  const from = params.get("From") ?? "";
  const to = params.get("To") ?? "";
  const callSid = params.get("CallSid") ?? "";

  const streamUrl = process.env.VOICE_SERVER_WS_URL;
  if (!streamUrl) {
    return new NextResponse("VOICE_SERVER_WS_URL is not configured", { status: 500 });
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(streamUrl)}">
      <Parameter name="call_sid" value="${escapeXml(callSid)}"/>
      <Parameter name="from" value="${escapeXml(from)}"/>
      <Parameter name="to" value="${escapeXml(to)}"/>
    </Stream>
  </Connect>
</Response>`;

  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}
