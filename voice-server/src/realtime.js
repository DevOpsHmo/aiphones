import WebSocket from "ws";
import {
  createOrderTool,
  getMenuTool,
  endCallTool,
  transferToHumanTool,
  humanTransferStarted,
  checkAddressTool,
  formatHeardStreet,
  matchDrinkProduct,
  getLastOrderTool,
  orderStatusTool,
  lockStreet,
  updateLastOrderTool
} from "./tools.js";
import { config } from "./config.js";
import { interruptionDecision } from "./turn-policy.js";
import { wantsHuman } from "./human-transfer.js";
import { correctHeard, emptyFacts, factsInstructions, inventedHeard, isAnsweredQuestion, isVocabularyEcho, lockFacts, looksLikeQuestion, orderedTurn, spokenExistingOrder, strayEcho } from "./call-flow.js";
import { emptyPcmState, isPcmFormat, pcmToPcmuBase64 } from "./phone-audio.js";

function isPromptEcho(text) {
  const normalized = text.trim().toLowerCase();
  return (
    isVocabularyEcho(text) ||
    normalized.startsWith("español de méxico") ||
    normalized.startsWith("conversación telefónica") ||
    normalized.startsWith("conversacion telefonica") ||
    (normalized.includes("boneless") && normalized.includes("bordes")) ||
    normalized === "vocabulario" ||
    normalized.includes("vocabulario:") ||
    (normalized.includes("mediana") && normalized.includes("familiar") && normalized.includes("lázaro")) ||
    normalized.includes("pedido nuevo, una pizza mediana") ||
    (normalized.includes("ochenta y tres ciento cincuenta y siete") && normalized.includes("issste"))
  );
}

function wantsCancel(text) {
  const normalized = String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\bcancel/.test(normalized);
}

const OPENAI_URL =
  `wss://api.openai.com/v1/realtime` +
  `?model=${encodeURIComponent(
    config.openaiRealtimeModel
  )}`;

export function createRealtimeSession({
  twilioSocket,
  streamSid,
  callId,
  callSid,
  callerPhone,
  businessId,
  previousTranscript = "",
  knownName = "",
  knownAddress = "",
  menuText = "",
  menuPrices = null,
  menuPromotions = [],
  menuHours = null,
  menuExtra = null,
  menuPayments = null,
  menuDescriptions = {},
  closedGreeting = "",
  resumeTransfer = false,
  onTranscript = null
}) {
  const openaiSocket =
    new WebSocket(
      OPENAI_URL,
      {
        headers: {
          Authorization:
            `Bearer ${config.openaiApiKey}`
        }
      }
    );

  let transcript = "";
  let startedAt = Date.now();
  let saveTimer = null;

  function currentTranscript() {
    let full = transcript;
    for (const text of pendingAssistant.values()) {
      const line = `IA: ${text}\n`;
      if (text && !full.includes(line)) {
        full += line;
      }
    }
    return full;
  }

  function scheduleSave() {
    if (!onTranscript) {
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      onTranscript(currentTranscript());
    }, 400);
  }
  let timeWarned = false;
  let silenceTimer = null;
  let askedIfThere = false;
  const callState = {
    orderPlaced: false,
    hangupScheduled: false,
    cancelled: false,
    closed: Boolean(closedGreeting),
    closeWhenSpoken: Boolean(closedGreeting),
    flow: {
      prices: menuPrices || undefined,
      promotions: menuPromotions || [],
      openTime: menuHours?.open || "",
      closeTime: menuHours?.close || "",
      extraPrice: menuExtra ?? undefined,
      payments: menuPayments || undefined,
      descriptions: menuDescriptions || {}
    }
  };
  let facts = emptyFacts();
  const playedResponses = new Set();
  const pendingAssistant = new Map();
  let instructionBase = "";
  let assistantSpeaking = false;
  let speakingSince = 0;
  let activeResponseId = "";
  let outputFormat = "audio/pcmu";
  let outputRate = 8000;
  let sessionReady = false;
  let greetingSent = false;
  const pcmState = emptyPcmState();
  const inboundQueue = [];

  function stopTalking() {
    assistantSpeaking = false;
    speechGeneration += 1;
    if (openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(JSON.stringify({ type: "response.cancel" }));
    }
    if (twilioSocket.readyState === WebSocket.OPEN) {
      twilioSocket.send(JSON.stringify({ event: "clear", streamSid }));
    }
  }

  function noteAudioFormat(format) {
    if (!format) return;
    const type = typeof format === "string" ? format : format.type;
    if (!type || type === outputFormat) return;
    outputFormat = type;
    outputRate = (typeof format === "object" && format.rate)
      || (isPcmFormat(type) ? 24000 : 8000);
    pcmState.carry = Buffer.alloc(0);
    pcmState.acc = 0;
    pcmState.accCount = 0;
    console.log(JSON.stringify({
      event: "openai_audio_format",
      format: outputFormat,
      rate: outputRate
    }));
  }

  function payloadForTwilio(delta) {
    if (typeof delta !== "string" || !delta) return "";
    if (!isPcmFormat(outputFormat)) return delta;
    return pcmToPcmuBase64(delta, pcmState, outputRate || 24000);
  }

  function sendInbound(payload) {
    if (!payload || openaiSocket.readyState !== WebSocket.OPEN) return;
    openaiSocket.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: payload
    }));
  }

  let lastSpoken = "";
  let speechGeneration = 0;
  const scriptedIds = new Set();
  const expectedById = new Map();
  const heardById = new Set();
  let pendingScripts = 0;
  let queuedPhrase = "";

  function acceptScripted(response) {
    const id = response?.id || "";
    if (response?.metadata?.source === "script") {
      if (pendingScripts > 0) pendingScripts -= 1;
      if (id) {
        scriptedIds.add(id);
        if (queuedPhrase) {
          expectedById.set(id, queuedPhrase);
          queuedPhrase = "";
        }
      }
      activeResponseId = id;
      return true;
    }
    if (id && openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(JSON.stringify({ type: "response.cancel", response_id: id }));
    }
    return false;
  }

  function sendGreeting() {
    if (greetingSent || twilioSocket.readyState !== WebSocket.OPEN) return;
    greetingSent = true;
    const phrase = closedGreeting || "Hola, bienvenido a Pizzería Hermosillo. ¿Cuál es su nombre?";
    lastSpoken = phrase;
    playExact(phrase);
  }

  function rememberAssistant(phrase) {
    const clean = String(phrase || "").trim();
    if (!clean) {
      return;
    }
    const line = `IA: ${clean}\n`;
    if (!transcript.endsWith(line)) {
      transcript += line;
    }
    scheduleSave();
  }

  async function fetchSpeechPcm(phrase) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "marin",
        response_format: "pcm",
        input: phrase,
        instructions: "Español de México, de usted, claro y pausado. Lee el texto tal cual, sin agregar ni cambiar palabras. Light se dice Light. Barbiquiú se dice barbiquiú."
      })
    });
    if (!response.ok) {
      throw new Error(`Voz ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async function playExact(phrase) {
    const generation = ++speechGeneration;
    rememberAssistant(phrase);
    assistantSpeaking = true;
    speakingSince = Date.now();
    try {
      const pcm = await fetchSpeechPcm(phrase);
      if (generation !== speechGeneration || twilioSocket.readyState !== WebSocket.OPEN) {
        return;
      }
      const samples = pcm.subarray(0, 4).toString("ascii") === "RIFF" ? pcm.subarray(44) : pcm;
      const encoded = pcmToPcmuBase64(samples.toString("base64"), emptyPcmState(), 24000);
      const audio = Buffer.from(encoded, "base64");
      const frame = 160;
      for (let offset = 0; offset < audio.length; offset += frame) {
        if (generation !== speechGeneration || twilioSocket.readyState !== WebSocket.OPEN) {
          return;
        }
        twilioSocket.send(JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: audio.subarray(offset, offset + frame).toString("base64") }
        }));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (generation === speechGeneration && /que tenga buen d[ií]a/i.test(phrase)) {
        callState.closeWhenSpoken = true;
      }
      if (generation === speechGeneration && callState.closeWhenSpoken && !callState.hangupScheduled) {
        callState.hangupScheduled = true;
        endCallTool(callSid, 600).catch(error => {
          console.error("No se pudo colgar:", error.message);
        });
      }
    } catch (error) {
      console.error("No se pudo decir la frase:", error.message);
    } finally {
      if (generation === speechGeneration) {
        assistantSpeaking = false;
      }
    }
  }

  function speakExact(phrase) {
    const clean = String(phrase || "").trim();
    if (!clean || clean === lastSpoken || twilioSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    lastSpoken = clean;
    if (openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(JSON.stringify({ type: "response.cancel" }));
    }
    playExact(clean);
  }

  function transcriptAgrees(expected, spoken) {
    const words = value => String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(word => word.length > 2);
    const left = words(expected);
    const right = new Set(words(spoken));
    if (!left.length || !right.size) {
      return false;
    }
    const hits = left.filter(word => right.has(word)).length;
    return hits / left.length >= 0.6;
  }

  function writeSpoken(id, spoken) {
    const clean = String(spoken || "").trim();
    const expected = id ? expectedById.get(id) : "";
    if (!clean || (expected && !transcriptAgrees(expected, clean))) {
      return;
    }
    const spokenLine = `IA: ${clean}\n`;
    const expectedLine = expected ? `IA: ${expected}\n` : "";
    if (expected && transcript.endsWith(expectedLine)) {
      if (spokenLine !== expectedLine) {
        transcript = transcript.slice(0, -expectedLine.length) + spokenLine;
      }
    } else if (!transcript.endsWith(spokenLine)) {
      transcript += spokenLine;
    }
    if (id) {
      heardById.add(id);
    }
    scheduleSave();
    armSilence();
  }

  function armSilence() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (callState.orderPlaced || callState.hangupScheduled || callState.cancelled || humanTransferStarted(callSid)) {
        return;
      }
      if (!askedIfThere) {
        askedIfThere = true;
        speakExact("Hola, ¿sigues ahí?");
        armSilence();
      }
    }, 30000);
  }

  function redirectToHuman() {
    transferToHumanTool(callSid).then(result => {
      if (result?.success && !result.duplicate && openaiSocket.readyState === WebSocket.OPEN) {
        openaiSocket.send(JSON.stringify({ type: "response.cancel" }));
      }
      if (result && result.success === false && result.spoken) {
        speakExact(result.spoken);
      }
    }).catch(error => {
      console.error("No se pudo transferir:", error.message);
    });
  }

  openaiSocket.on("open", () => {
    const session = {
      type: "session.update",
      session: {
        type: "realtime",
        model:
          config.openaiRealtimeModel,

        output_modalities: [
          "audio"
        ],

        audio: {
          input: {
            format: {
              type: "audio/pcmu"
            },
            transcription: {
              model: "gpt-4o-transcribe",
              language: "es",
              prompt: "Conversación telefónica en español de México sobre un pedido de pizza."
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.9,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
              create_response: false,
              interrupt_response: false
            }
          },

          output: {
            format: {
              type: "audio/pcmu"
            },
            voice: "marin"
          }
        },

        instructions: `Eres la voz de Pizzería Hermosillo. No converses y no contestes por tu cuenta. Solo pronuncias, palabra por palabra, la frase que viene entre comillas triples en la instrucción de cada respuesta. Después guardas silencio. No saludes, no preguntes, no confirmes y no agregues palabras. Si la frase dice Light, di Light. Si dice barbiquiú, di barbiquiú.`,

        tools: [
          {
            type: "function",
            name: "check_address",
            description:
              "Verifica un código postal de Hermosillo. Pasa postalCode con las palabras oídas, sin convertirlas. ochenta y tres cero diez es 83010. ocho tres cero uno cero es 83010. cero es un dígito y no se omite.",
            parameters: {
              type: "object",
              properties: {
                postalCode: { type: "string" },
                street: { type: "string" },
                colony: { type: "string" }
              },
              required: ["postalCode", "street", "colony"],
              additionalProperties: false
            }
          },

          {
            type: "function",
            name: "create_order",
            description:
              "Crea el pedido confirmado una sola vez. Si ya quedó guardado, no lo llames de nuevo.",
            parameters: {
              type: "object",
              properties: {
                confirmed: {
                  type: "boolean"
                },

                customerName: {
                  type: "string"
                },

                customerPhone: {
                  type: "string"
                },

                orderType: {
                  type: "string",
                  enum: [
                    "pickup",
                    "delivery"
                  ]
                },

                address: {
                  type: "string",
                  description: "No uses este texto si ya mandas calle, número, colonia y código. Nunca incluyas para empezar, es la colonia ni mi nombre es."
                },
                street: { type: "string", description: "Solo el nombre de la calle, sin número y sin frases." },
                number: { type: "string", description: "Solo el número de la casa, en dígitos." },
                colony: { type: "string", description: "Solo la colonia que dijo el cliente." },
                postalCode: { type: "string", description: "Código postal de 5 dígitos." },

                paymentMethod: {
                  type: "string",
                  enum: [
                    "efectivo",
                    "transferencia",
                    "tarjeta"
                  ]
                },

                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      product_id: {
                        type: "string"
                      },
                      quantity: {
                        type: "integer"
                      },
                      size: {
                        type: "string",
                        enum: [
                          "mediana",
                          "grande",
                          "familiar"
                        ]
                      },
                      sauce: {
                        type: "string",
                        enum: [
                          "bbq",
                          "buffalo"
                        ]
                      },
                      extra: {
                        type: "string"
                      },
                      extras: {
                        type: "array",
                        items: { type: "string" }
                      },
                      note: {
                        type: "string"
                      }
                    },
                    required: [
                      "product_id",
                      "quantity"
                    ],
                    additionalProperties:
                      false
                  }
                }
              },

              required: [
                "confirmed",
                "customerName",
                "customerPhone",
                "orderType",
                "paymentMethod",
                "items"
              ],

              additionalProperties:
                false
            }
          },

          {
            type: "function",
            name: "order_status",
            description:
              "Revisa en Pedidos el estado de hoy de este teléfono. Úsala cuando pregunten cómo va su pedido.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          },

          {
            type: "function",
            name: "get_last_order",
            description:
              "Busca el último pedido confirmado de este teléfono en las últimas 2 horas.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          },

          {
            type: "function",
            name: "update_last_order",
            description:
              "Modifica el último pedido confirmado de este teléfono.",
            parameters: {
              type: "object",
              properties: {
                customerName: {
                  type: "string"
                },
                product_id: {
                  type: "string"
                },
                size: {
                  type: "string",
                  enum: [
                    "mediana",
                    "grande",
                    "familiar"
                  ]
                },
                sauce: {
                  type: "string",
                  enum: [
                    "bbq",
                    "buffalo"
                  ]
                },
                quantity: {
                  type: "integer"
                }
              },
              required: ["customerName"],
              additionalProperties: false
            }
          },

          {
            type: "function",
            name: "transfer_to_human",
            description:
              "Pasa la llamada solo si el cliente pidió hablar con un encargado o con un humano. No la uses por confusión ni por una pregunta.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          },

          {
            type: "function",
            name: "end_call",
            description:
              "Cuelga la llamada después de despedirte.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          }
        ],

        tool_choice: "none"
      }
    };

    instructionBase = session.session.instructions;
    session.session.instructions = instructionBase.replace("__DATOS_FIJOS__", factsInstructions(facts));
    openaiSocket.send(
      JSON.stringify(session)
    );

    setTimeout(() => {
      if (!greetingSent) {
        console.error("OpenAI no confirmó el audio; se envía el saludo igual");
        sendGreeting();
      }
    }, 1500);
  });

  openaiSocket.on(
    "message",
    async raw => {
      try {
        const event =
          JSON.parse(
            raw.toString()
          );

        if (event.type === "session.updated") {
          const confirmed = event.session?.audio?.output?.format || event.session?.output_audio_format;
          console.log(JSON.stringify({
            event: "openai_session_audio",
            format: typeof confirmed === "string" ? confirmed : confirmed?.type || outputFormat,
            rate: confirmed?.rate || outputRate
          }));
          noteAudioFormat(confirmed);
          sessionReady = true;
          while (inboundQueue.length) sendInbound(inboundQueue.shift());
          sendGreeting();
        }

        if (event.type === "response.created") {
          noteAudioFormat(event.response?.audio?.output?.format || event.response?.output_audio_format);
          if (!acceptScripted(event.response)) {
            return;
          }
          assistantSpeaking = true;
          speakingSince = Date.now();
        }

        if (
          event.type === "response.done" ||
          event.type === "response.cancelled"
        ) {
          assistantSpeaking = false;
          const doneId = event.response?.id || event.response_id || "";
          if (event.type === "response.done" && doneId && expectedById.has(doneId) && !heardById.has(doneId)) {
            rememberAssistant(expectedById.get(doneId));
            heardById.add(doneId);
          }
          if (event.type === "response.done" && callState.closeWhenSpoken && !callState.hangupScheduled) {
            callState.hangupScheduled = true;
            endCallTool(callSid).catch(error => {
              console.error("No se pudo colgar:", error.message);
            });
          }
        }

        if (
          event.type ===
          "response.output_audio.delta" ||
          event.type ===
          "response.audio.delta"
        ) {
          assistantSpeaking = true;
          if (!event.response_id || !scriptedIds.has(event.response_id)) {
            return;
          }
          const payload = payloadForTwilio(event.delta);
          if (
            twilioSocket.readyState ===
            WebSocket.OPEN &&
            payload
          ) {
            twilioSocket.send(
              JSON.stringify({
                event: "media",
                streamSid,
                media: {
                  payload
                }
              })
            );
          }
        }

        if (
          event.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          if (event.transcript && !isPromptEcho(event.transcript) && !inventedHeard(event.transcript)) {
            const heard = correctHeard(event.transcript);
            if (inventedHeard(heard) || strayEcho(heard, callState.flow || {})) {
              return;
            }
            transcript +=
              `Cliente: ${heard}\n`;
            scheduleSave();
            const decision = interruptionDecision({
              event: "transcript",
              transcript: event.transcript
            });
            askedIfThere = false;
            const heardStreet = formatHeardStreet(heard);
            facts = lockFacts(facts, heard);
            if (heardStreet) {
              callState.heardStreet = heardStreet;
            }
            armSilence();
            if (callState.closed) {
              return;
            }
            if (wantsHuman(heard)) {
              callState.transferAsked = true;
              redirectToHuman();
            } else {
              lastSpoken = "";
              const turn = orderedTurn(callState.flow || {}, heard);
              callState.flow = turn.state;
              if (turn.transfer) {
                callState.transferAsked = true;
                speakExact(turn.say);
                redirectToHuman();
              } else if (turn.cancel) {
                callState.cancelled = true;
                callState.closeWhenSpoken = true;
                speakExact(turn.say);
              } else if (turn.save && !callState.orderPlaced && turn.state.adding) {
                const flow = turn.state;
                const wanted = [...(flow.items || [])];
                if (flow.product && flow.size) {
                  wanted.push({ product: flow.product, size: flow.size, sauce: flow.sauce || "", extras: flow.extras || [], half: flow.half || "" });
                }
                getMenuTool(businessId).then(async menu => {
                  const foldName = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/pepperoni/g, "peperoni").replace(/hawaiana/g, "hawaina");
                  for (const line of wanted) {
                    const name = foldName(line.product);
                    const product = (menu.products || []).find(item => {
                      const have = foldName(item.name);
                      return (name.includes("boneless") && have.includes("boneless")) || have.includes(name) || name.includes(have);
                    });
                    if (!product) {
                      throw new Error("No encontré esa pizza en el menú.");
                    }
                    await updateLastOrderTool({
                      businessId,
                      callerPhone,
                      customerName: flow.name,
                      productId: product.id,
                      size: line.size,
                      sauce: line.sauce || "",
                      quantity: 1
                    });
                  }
                  return { success: true };
                }).then(result => {
                  if (result?.success) {
                    callState.orderPlaced = true;
                    callState.closeWhenSpoken = true;
                    speakExact(turn.say);
                  }
                }).catch(error => {
                  console.error("No se pudo agregar al pedido:", error.message);
                  speakExact(error.message || "No pude agregar eso al pedido.");
                });
              } else if (turn.save && !callState.orderPlaced) {
                const flow = turn.state;
                getMenuTool(businessId).then(menu => {
                  const wanted = [...(flow.items || [])];
                  if (flow.product && flow.size) {
                    wanted.push({ product: flow.product, size: flow.size, sauce: flow.sauce || "", extras: flow.extras || [], half: flow.half || "" });
                  }
                  const foldName = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/pepperoni/g, "peperoni").replace(/hawaiana/g, "hawaina");
                  const items = wanted.map(line => {
                    const name = foldName(line.product);
                    const product = (menu.products || []).find(item => {
                      const have = foldName(item.name);
                      return (name.includes("boneless") && have.includes("boneless")) || have.includes(name) || name.includes(have);
                    });
                    return product ? { product_id: product.id, quantity: 1, size: line.size, sauce: line.sauce || "", extras: line.extras || [], note: line.half || "" } : null;
                  });
                  if (flow.drink?.volume) {
                    const drinkProduct = matchDrinkProduct(menu.products, flow.drink);
                    if (drinkProduct) {
                      items.push({ product_id: drinkProduct.id, quantity: 1 });
                    }
                  }
                  if (items.some(item => !item)) {
                    callState.flow = { ...flow, agreed: false, closingAsked: true };
                    speakExact("No pude dejar listo el pedido. ¿Me confirma otra vez?");
                    return null;
                  }
                  const place = `${flow.street} ${flow.house}, ${flow.colony}, C.P. ${flow.postalCode}, Hermosillo, Sonora`
                    .replace(/\./g, " ")
                    .replace(/\bcolonia\b/gi, "")
                    .replace(/\s+/g, " ")
                    .replace(/\s+,/g, ",")
                    .trim();
                  return createOrderTool({
                    businessId,
                    callId,
                    customerName: flow.name,
                    customerPhone: callerPhone,
                    orderType: "delivery",
                    street: flow.street,
                    number: flow.house,
                    colony: flow.colony,
                    postalCode: flow.postalCode,
                    address: place,
                    items,
                    confirmed: true,
                    paymentMethod: "efectivo"
                  });
                }).then(result => {
                  if (result?.success) {
                    callState.orderPlaced = true;
                    callState.closeWhenSpoken = true;
                    const number = result.order_number ? `Su pedido quedó guardado con el número ${result.order_number}. ` : "";
                    speakExact(`${number}${turn.say}`);
                  }
                }).catch(error => {
                  console.error("No se pudo guardar el pedido confirmado:", error.message);
                  speakExact("No pude dejar listo el pedido. ¿Me confirma otra vez?");
                });
              } else if (turn.status) {
                orderStatusTool({ businessId, callerPhone }).then(result => {
                  if (!result?.found) {
                    speakExact(result?.spoken || "No encuentro un pedido de hoy en este teléfono.");
                    return;
                  }
                  const who = turn.state?.name || result.customer_name || "";
                  const ask = `Disculpa${who ? ` ${who}` : ""}, ¿ordenaste ${spokenExistingOrder(result.items)}?`;
                  callState.flow = {
                    ...(turn.state || {}),
                    statusAsk: true,
                    pendingStatus: result.status || "new"
                  };
                  speakExact(ask);
                }).catch(error => {
                  console.error("No se pudo consultar el pedido:", error.message);
                  speakExact(turn.say);
                });
              } else if (turn.say) {
                if (assistantSpeaking) {
                  stopTalking();
                }
                if (looksLikeQuestion(heard) && !turn.answered && !isAnsweredQuestion(turn.say)) {
                  speakExact(`Eso no está en el menú. ${turn.say}`);
                } else {
                  speakExact(turn.say);
                }
              }
            }
          }
        }

        if (
          event.type === "response.output_audio.delta" ||
          event.type === "response.audio.delta"
        ) {
          if (event.response_id && scriptedIds.has(event.response_id)) {
            playedResponses.add(event.response_id);
            const waiting = pendingAssistant.get(event.response_id);
            if (waiting && !transcript.includes(`IA: ${waiting}\n`)) {
              transcript += `IA: ${waiting}\n`;
              scheduleSave();
            }
            pendingAssistant.delete(event.response_id);
          }
        }

        if (
          event.type ===
          "response.output_audio_transcript.done" ||
          event.type ===
          "response.audio_transcript.done"
        ) {
          if (!event.response_id || scriptedIds.has(event.response_id)) {
          if (event.transcript && event.response_id && scriptedIds.has(event.response_id)) {
            writeSpoken(event.response_id, event.transcript);
          } else if (event.transcript && event.response_id && !playedResponses.has(event.response_id)) {
            pendingAssistant.set(event.response_id, event.transcript);
          } else if (event.transcript && (!event.response_id || playedResponses.has(event.response_id))) {
            if (!event.response_id || !transcript.endsWith(`IA: ${event.transcript}\n`)) {
              transcript +=
                `IA: ${event.transcript}\n`;
            }
            armSilence();
            scheduleSave();
            if (
              (callState.orderPlaced || callState.cancelled) &&
              /hasta luego|hasta pronto|tu pedido quedó confirmado/i.test(event.transcript) &&
              !callState.hangupScheduled &&
              !humanTransferStarted(callSid) &&
              !wantsHuman(event.transcript)
            ) {
              callState.hangupScheduled = true;
              endCallTool(callSid).catch(error => {
                console.error("No se pudo colgar:", error.message);
              });
            }
          }
          }
        }

        if (
          event.type ===
          "response.function_call_arguments.done"
        ) {
          await handleToolCall(
            openaiSocket,
            event,
            callId,
            callSid,
            callerPhone,
            businessId,
            callState
          );
        }

        if (
          event.type === "error"
        ) {
          console.error(
            "OpenAI error:",
            JSON.stringify(event.error)
          );
          if (!greetingSent) sendGreeting();
        }
      } catch (error) {
        console.error(
          "Realtime event error:",
          error
        );
      }
    }
  );

  openaiSocket.on(
    "error",
    error => {
      console.error(
        "OpenAI socket error:",
        error
      );
    }
  );

  return {
    socket: openaiSocket,

    getTranscript() {
      return currentTranscript();
    },

    appendCallerAudio(payload) {
      if (!payload) return;
      if (!sessionReady || openaiSocket.readyState !== WebSocket.OPEN) {
        inboundQueue.push(payload);
        if (inboundQueue.length > 250) inboundQueue.shift();
        return;
      }
      sendInbound(payload);
    },

    getDurationSeconds() {
      return Math.round(
        (Date.now() -
          startedAt) /
          1000
      );
    },

    warnTimeUp() {
      if (callState.orderPlaced || timeWarned || openaiSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      timeWarned = true;
      speakExact("Disculpa, el tiempo de esta llamada se agotó, vuelve a marcar para retomar tu pedido.");
    }
  };
}

async function handleToolCall(
  socket,
  event,
  callId,
  callSid,
  callerPhone,
  businessId,
  callState
) {
  let args = {};

  try {
    args = JSON.parse(
      event.arguments || "{}"
    );
  } catch {
    args = {};
  }

  let result;

  try {
    if (event.name === "check_address") {
      result = await checkAddressTool({
        postalCode: args.postalCode,
        street: callState.heardStreet || args.street,
        colony: args.colony
      });
    }

    else if (
      event.name === "create_order"
    ) {
      result =
        await createOrderTool({
          businessId,
          callId,
          customerName:
            args.customerName,
          customerPhone:
            args.customerPhone ||
            callerPhone,
          orderType:
            args.orderType,
          address: lockStreet(args.address, callState.heardStreet),
          street: args.street,
          number: args.number,
          colony: args.colony,
          postalCode: args.postalCode,
          items:
            args.items,
          confirmed:
            args.confirmed,
          paymentMethod:
            args.paymentMethod || "efectivo"
        });

      if (result?.success) {
        callState.orderPlaced = true;
      }
    }

    else if (event.name === "order_status") {
      result = await orderStatusTool({
        businessId,
        callerPhone
      });
    }

    else if (event.name === "get_last_order") {
      result = await getLastOrderTool({
        businessId,
        callerPhone
      });
    }

    else if (event.name === "update_last_order") {
      result = await updateLastOrderTool({
        businessId,
        callerPhone,
        customerName: args.customerName,
        productId: args.product_id,
        size: args.size,
        sauce: args.sauce,
        quantity: args.quantity
      });
    }

    else if (event.name === "transfer_to_human") {
      if (!callState.transferAsked) {
        result = { success: false, error: "No transfieras. Sigue con el pedido." };
      } else {
        result = await transferToHumanTool(callSid);
        if (result?.success && !result.duplicate && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "response.cancel" }));
        }
      }
    }

    else if (event.name === "end_call") {
      if (!callState.orderPlaced && !callState.cancelled) {
        result = {
          success: false,
          error: "El pedido no está guardado. No cuelgues. Sigue con la toma."
        };
      } else if (!humanTransferStarted(callSid) && !callState.hangupScheduled && !callState.transferAsked) {
        callState.hangupScheduled = true;
        endCallTool(callSid).catch(error => {
          console.error(
            "No se pudo colgar:",
            error.message
          );
        });
        result = { success: true };
      } else {
        result = { success: true };
      }
    }

    else {
      result = {
        success: false,
        error:
          "Herramienta desconocida."
      };
    }
  } catch (error) {
    console.error(
      "Tool error:",
      error
    );

    result = {
      success: false,
      error:
        error.message ||
        "Error interno."
    };
  }

  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      type:
        "conversation.item.create",

      item: {
        type:
          "function_call_output",

        call_id:
          event.call_id,

        output:
          JSON.stringify(result)
      }
    })
  );

  if (event.name === "transfer_to_human" && result?.success) {
    return;
  }

  if (event.name === "order_status" && result?.spoken) {
    socket.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          tool_choice: "none",
          conversation: "none",
          metadata: { source: "script" },
          instructions: `Pronuncia únicamente el texto entre comillas triples, palabra por palabra, y después guarda silencio.\n"""${result.spoken}"""`
        }
      })
    );
    return;
  }

  if (event.name === "create_order" && result?.success && result.spoken) {
    socket.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          tool_choice: "none",
          conversation: "none",
          metadata: { source: "script" },
          instructions: `Pronuncia únicamente el texto entre comillas triples, palabra por palabra, y después guarda silencio.\n"""${result.spoken}"""`
        }
      })
    );
    return;
  }

  if (event.name === "end_call" && result?.success) {
    return;
  }

}
