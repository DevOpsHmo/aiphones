import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
import { config } from "./config.js";

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    realtime: {
      transport: WebSocket
    }
  }
);

export function normalizePhone(value) {
  if (!value) {
    return "";
  }

  const digits = String(value).replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  return `+${digits}`;
}

export async function getBusinessByTwilioPhone(twilioTo) {
  const normalized = normalizePhone(twilioTo);

  if (!normalized) {
    return null;
  }

  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("twilio_phone", normalized)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data;
  }

  if (config.businessId) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", config.businessId)
      .maybeSingle();

    if (fallbackError) {
      throw fallbackError;
    }

    return fallback;
  }

  return null;
}

function monthStartHermosilloIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Hermosillo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;

  return `${year}-${month}-01T00:00:00-07:00`;
}

export async function getMonthUsageSeconds(businessId) {
  const from = monthStartHermosilloIso();
  const now = Date.now();

  const { data, error } = await supabase
    .from("calls")
    .select("status, duration_seconds, started_at")
    .eq("business_id", businessId)
    .neq("status", "overflow")
    .gte("started_at", from);

  if (error) {
    throw error;
  }

  let seconds = 0;

  for (const call of data || []) {
    if (
      call.status === "in_progress" &&
      call.started_at
    ) {
      seconds += Math.max(
        0,
        Math.round(
          (now - new Date(call.started_at).getTime()) / 1000
        )
      );
      continue;
    }

    seconds += Number(call.duration_seconds) || 0;
  }

  return seconds;
}

export async function createCall({
  businessId,
  twilioCallSid,
  callerPhone,
  status = "in_progress"
}) {
  const { data, error } = await supabase
    .from("calls")
    .insert({
      business_id: businessId,
      twilio_call_sid: twilioCallSid,
      caller_phone: callerPhone || null,
      status
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function finishCall({
  callId,
  transcript,
  durationSeconds
}) {
  const { error } = await supabase
    .from("calls")
    .update({
      status: "completed",
      transcript: transcript || null,
      duration_seconds:
        durationSeconds || null,
      ended_at: new Date().toISOString()
    })
    .eq("id", callId)
    .eq("status", "in_progress");

  if (error) {
    console.error(
      "finishCall error:",
      error.message
    );
  }
}
