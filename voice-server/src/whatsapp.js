// Envio de confirmacion por WhatsApp Business Cloud API (solo saliente).
export async function sendWhatsAppConfirmation({ to, orderId, total }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn("[whatsapp] WHATSAPP_ACCESS_TOKEN / PHONE_NUMBER_ID no configurados; se omite el envio");
    return;
  }

  const shortId = orderId.slice(0, 6).toUpperCase();
  const totalText = `$${Number(total).toFixed(2)}`;
  const recipient = to.replace("+", "");

  let payload;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  if (templateName) {
    // Conversacion iniciada por el negocio: se requiere plantilla HSM aprobada.
    payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "template",
      template: {
        name: templateName,
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: shortId },
              { type: "text", text: totalText },
            ],
          },
        ],
      },
    };
  } else {
    // Solo funciona si existe una ventana de 24h abierta con el cliente.
    payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "text",
      text: {
        body: `Tu pedido #${shortId} fue recibido. Total: ${totalText}. Te avisaremos cuando esté listo.`,
      },
    };
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${body}`);
  }
}
