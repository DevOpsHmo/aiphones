import dotenv from "dotenv";

dotenv.config();

const required = [
  "OPENAI_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "PUBLIC_VOICE_BASE_URL"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(
      `Falta la variable de entorno: ${key}`
    );
  }
}

export const config = {
  port: Number(process.env.PORT || 3001),

  openaiApiKey:
    process.env.OPENAI_API_KEY,

  openaiRealtimeModel:
    process.env.OPENAI_REALTIME_MODEL ||
    "gpt-realtime-2.1-mini",

  twilioAccountSid:
    process.env.TWILIO_ACCOUNT_SID,

  twilioAuthToken:
    process.env.TWILIO_AUTH_TOKEN,

  supabaseUrl:
    process.env.SUPABASE_URL,

  supabaseSecretKey:
    process.env.SUPABASE_SECRET_KEY,

  publicVoiceBaseUrl:
    process.env.PUBLIC_VOICE_BASE_URL.replace(/\/$/, ""),

  businessId:
    process.env.BUSINESS_ID || null,

  validateTwilioSignature:
    process.env.VALIDATE_TWILIO_SIGNATURE === "true"
};
