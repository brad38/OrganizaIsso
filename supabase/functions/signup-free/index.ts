import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://organizaisso.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);

const jsonHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://organizaisso.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
});

function response(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders(origin)
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: jsonHeaders(origin) });
  }

  if (req.method !== "POST") {
    return response(origin, 405, { error: "Método não permitido." });
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return response(origin, 403, { error: "Origem não permitida." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase Edge Function environment variables");
    return response(origin, 500, { error: "Configuração do servidor indisponível." });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return response(origin, 400, { error: "Dados de cadastro inválidos." });
  }

  const displayName = String(payload.displayName ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const password = String(payload.password ?? "");
  const termsAccepted = payload.termsAccepted === true;
  const privacyAcknowledged = payload.privacyAcknowledged === true;
  const emailReminders = payload.emailReminders === true;
  const legalVersion = String(payload.legalVersion ?? "").trim();

  if (displayName.length < 2 || displayName.length > 100) {
    return response(origin, 400, { error: "Informe um nome de exibição válido." });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return response(origin, 400, { error: "Informe um e-mail válido." });
  }

  if (password.length < 8 || password.length > 128) {
    return response(origin, 400, { error: "A senha deve ter entre 8 e 128 caracteres." });
  }

  if (!termsAccepted || !privacyAcknowledged || !legalVersion) {
    return response(origin, 400, { error: "Aceite os termos e o aviso de privacidade." });
  }

  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp = req.headers.get("cf-connecting-ip") || forwardedFor || "unknown";
  const [ipHash, emailHash] = await Promise.all([
    sha256(`ip:${clientIp}`),
    sha256(`email:${email}`)
  ]);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const [ipRate, emailRate] = await Promise.all([
    admin.rpc("consume_signup_rate_limit", {
      p_key_hash: ipHash,
      p_limit: 5,
      p_window_seconds: 3600
    }),
    admin.rpc("consume_signup_rate_limit", {
      p_key_hash: emailHash,
      p_limit: 3,
      p_window_seconds: 3600
    })
  ]);

  if (ipRate.error || emailRate.error) {
    console.error("Signup rate limit RPC failed", ipRate.error || emailRate.error);
    return response(origin, 500, { error: "Não foi possível validar o cadastro agora." });
  }

  if (ipRate.data !== true || emailRate.data !== true) {
    return response(origin, 429, {
      error: "Muitas tentativas de cadastro. Aguarde antes de tentar novamente."
    });
  }

  const now = new Date().toISOString();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      terms_version: legalVersion,
      privacy_version: legalVersion,
      terms_accepted_at: now,
      privacy_acknowledged_at: now,
      email_reminders_opt_in: emailReminders,
      signup_method: "free_no_email"
    }
  });

  if (error) {
    console.error("Admin signup failed", {
      status: error.status,
      code: error.code,
      message: error.message
    });

    const normalized = (error.message || "").toLowerCase();
    if (
      normalized.includes("already") ||
      normalized.includes("registered") ||
      error.status === 422
    ) {
      return response(origin, 409, {
        error: "Já existe uma conta com este e-mail."
      });
    }

    return response(origin, 400, {
      error: "Não foi possível criar a conta agora."
    });
  }

  return response(origin, 201, {
    ok: true,
    userId: data.user?.id ?? null
  });
});
