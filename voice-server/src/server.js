import "./polyfill-ws.js";
import express from "express";
import http from "http";
import WebSocket, {
  WebSocketServer
} from "ws";

import twilio from "twilio";

import {
  config
} from "./config.js";

import {
  createCall,
  finishCall,
  getBusinessByTwilioPhone,
  getMonthUsageSeconds,
  normalizePhone,
  supabase
} from "./supabase.js";
import {
  formatMenuForPrompt,
  getMenuTool,
  refreshHermosilloCatalog,
  abandonHumanTransfer,
  humanTransferStarted
} from "./tools.js";

import {
  createRealtimeSession
} from "./realtime.js";

const app =
  express();

app.use(
  express.urlencoded({
    extended: false
  })
);

app.use(
  express.json()
);

function toWssUrl(httpUrl, path) {
  let base = httpUrl.trim().replace(/\/$/, "");

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    base = `https://${base}`;
  }

  base = base
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:");

  return `${base}${path}`;
}

function validateTwilioSignature(req, res, next) {
  if (!config.validateTwilioSignature) {
    return next();
  }

  const signature = req.headers["x-twilio-signature"];
  const url = `${config.publicVoiceBaseUrl}${req.originalUrl}`;
  const valid = twilio.validateRequest(
    config.twilioAuthToken,
    signature,
    url,
    req.body
  );

  if (!valid) {
    console.error("Twilio signature inválida");
    return res.status(403).send("Forbidden");
  }

  return next();
}

function sendTwiml(res, response) {
  res.type("text/xml");
  res.send(response.toString());
}

const server =
  http.createServer(app);

const wss =
  new WebSocketServer({
    server,
    path: "/twilio/media"
  });

app.post(
  "/twilio/overflow",
  validateTwilioSignature,
  (req, res) => {
    const response = new twilio.twiml.VoiceResponse();
    const dial = response.dial({ timeout: 30 });
    dial.number(config.humanTransferNumber);
    sendTwiml(res, response);
  }
);

app.post(
  "/twilio/transfer-result",
  validateTwilioSignature,
  async (req, res) => {
    const status = req.body.DialCallStatus || "";
    const callSid = req.body.CallSid || "";
    const response = new twilio.twiml.VoiceResponse();
    if (status === "completed" || status === "answered") {
      response.hangup();
      sendTwiml(res, response);
      return;
    }

    abandonHumanTransfer(callSid);
    console.log(JSON.stringify({
      event: "transfer_unanswered",
      callSid,
      at: new Date().toISOString(),
      status
    }));

    try {
      const { data: previous } = await supabase
        .from("calls")
        .select("id,business_id,caller_phone")
        .eq("twilio_call_sid", callSid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!previous?.id || !previous.business_id) {
        throw new Error("No hay llamada para retomar");
      }
      const { error: reopenError } = await supabase
        .from("calls")
        .update({ status: "in_progress", ended_at: null })
        .eq("id", previous.id);
      if (reopenError) {
        throw reopenError;
      }
      const connect = response.connect();
      const stream = connect.stream({
        url: toWssUrl(config.publicVoiceBaseUrl, "/twilio/media")
      });
      stream.parameter({ name: "callId", value: previous.id });
      stream.parameter({ name: "callerPhone", value: previous.caller_phone || "" });
      stream.parameter({ name: "businessId", value: previous.business_id });
      stream.parameter({ name: "resume", value: "transfer" });
    } catch (error) {
      console.error("No se pudo retomar la llamada:", error.message);
      response.say(
        { language: "es-MX" },
        "No pudieron tomar la llamada. Sigo con su pedido."
      );
    }
    sendTwiml(res, response);
  }
);

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "ai-phone",
      node: process.version
    });
  }
);

app.post(
  "/twilio/voice",
  validateTwilioSignature,
  async (req, res) => {
    try {
      const callSid =
        req.body.CallSid;

      const callerPhone =
        req.body.From || null;

      const twilioTo =
        req.body.To || "";

      const business =
        await getBusinessByTwilioPhone(
          twilioTo
        );

      if (!business) {
        throw new Error(
          `Negocio no encontrado para ${twilioTo}`
        );
      }

      const usedSeconds =
        await getMonthUsageSeconds(
          business.id
        );

      const limitSeconds =
        (business.monthly_minute_limit || 1000) * 60;

      if (usedSeconds >= limitSeconds) {
        await createCall({
          businessId: business.id,
          twilioCallSid: callSid,
          callerPhone,
          status: "overflow"
        });

        const overflowDigits = String(
          business.overflow_phone || business.phone || ""
        ).replace(/\D/g, "");
        const overflow = overflowDigits.length === 10
          ? `+52${overflowDigits}`
          : normalizePhone(business.overflow_phone) ||
            normalizePhone(business.phone);

        const response =
          new twilio.twiml.VoiceResponse();

        if (overflow) {
          response.dial(
            {
              timeout: 30
            },
            overflow
          );
        } else {
          response.say(
            {
              language: "es-MX"
            },
            "En este momento no podemos tomar su pedido por teléfono. Intente más tarde."
          );
          response.hangup();
        }

        sendTwiml(res, response);
        return;
      }

      const call =
        await createCall({
          businessId: business.id,
          twilioCallSid: callSid,
          callerPhone
        });

      const response =
        new twilio.twiml.VoiceResponse();

      const connect =
        response.connect();

      const stream =
        connect.stream({
          url:
            toWssUrl(
              config.publicVoiceBaseUrl,
              "/twilio/media"
            )
        });

      stream.parameter({
        name: "callId",
        value: call.id
      });

      stream.parameter({
        name: "callerPhone",
        value:
          callerPhone || ""
      });

      stream.parameter({
        name: "businessId",
        value: business.id
      });

      sendTwiml(res, response);
    } catch (error) {
      console.error(
        "Voice webhook error:",
        error
      );

      const response =
        new twilio.twiml.VoiceResponse();

      response.say(
        {
          language:
            "es-MX"
        },
        "Lo sentimos. En este momento no podemos atender la llamada."
      );

      response.hangup();

      sendTwiml(res, response);
    }
  }
);

wss.on(
  "connection",
  socket => {
    let streamSid = null;
    let callSid = null;
    let callId = null;
    let callerPhone = null;
    let businessId = null;

    let realtime = null;
    let finalized = false;
    let limitTimer = null;
    let warningTimer = null;

    const client = twilio(
      config.twilioAccountSid,
      config.twilioAuthToken
    );

    socket.on(
      "message",
      async raw => {
        try {
          const message =
            JSON.parse(
              raw.toString()
            );

          if (
            message.event ===
            "connected"
          ) {
            console.log(
              "Twilio connected"
            );

            return;
          }

          if (
            message.event ===
            "start"
          ) {
            streamSid =
              message.start
                .streamSid;

            callSid =
              message.start
                .callSid;

            const params =
              message.start
                .customParameters ||
              {};

            callId =
              params.callId;

            callerPhone =
              params.callerPhone ||
              null;

            businessId =
              params.businessId ||
              null;

            console.log(
              "Call started:",
              callSid
            );

            let menuText = "";

            try {
              const menu = await getMenuTool(businessId);
              menuText = formatMenuForPrompt(menu);
            } catch (error) {
              console.error(
                "No se pudo cargar el menú:",
                error.message
              );
            }

            realtime =
              createRealtimeSession({
                twilioSocket:
                  socket,
                streamSid,
                callId,
                callSid,
                callerPhone,
                businessId,
                menuText,
                resumeTransfer: params.resume === "transfer"
              });

            return;
          }

          if (
            message.event ===
            "media"
          ) {
            realtime?.appendCallerAudio?.(
              message.media?.payload
            );

            return;
          }

          if (
            message.event ===
            "stop"
          ) {
            await finalize();

            return;
          }
        } catch (error) {
          console.error(
            "Twilio message error:",
            error
          );
        }
      }
    );

    socket.on(
      "close",
      async () => {
        await finalize();
      }
    );

    socket.on(
      "error",
      async error => {
        console.error(
          "Twilio socket error:",
          error
        );

        await finalize();
      }
    );

    async function finalize() {
      if (finalized) {
        return;
      }

      finalized = true;

      if (limitTimer) {
        clearTimeout(limitTimer);
        limitTimer = null;
      }

      if (warningTimer) {
        clearTimeout(warningTimer);
        warningTimer = null;
      }

      try {
        if (
          realtime &&
          callId
        ) {
          await finishCall({
            callId,
            transcript:
              realtime.getTranscript(),
            durationSeconds: realtime.getDurationSeconds()
          });
        }
      } catch (error) {
        console.error(
          "Finalize error:",
          error
        );
      }

      try {
        if (
          realtime?.socket
            ?.readyState ===
          WebSocket.OPEN
        ) {
          realtime.socket.close();
        }
      } catch {}
    }
  }
);

server.listen(
  config.port,
  () => {
    console.log(
      `AI Phone voice server running on ${config.port}`
    );
    refreshHermosilloCatalog().catch(error => {
      console.error(
        "No se actualizó el directorio postal:",
        error.message
      );
    });
  }
);
