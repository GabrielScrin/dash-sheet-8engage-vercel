import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-share-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type GoogleAdsConnectionRow = {
  project_id: string;
  user_id: string;
  refresh_token: string;
  customer_id: string | null;
  login_customer_id: string | null;
  customer_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
};

const GOOGLE_OAUTH_URL = "https://www.googleapis.com/oauth2/v3/token";
const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com/v20";

const normalizeCustomerId = (value: string | null | undefined) =>
  String(value || "").replace(/\D/g, "");

async function refreshAccessToken(connection: GoogleAdsConnectionRow) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Secrets GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET não configuradas");
  }

  const response = await fetch(GOOGLE_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Falha ao renovar token do Google Ads");
  }

  return String(data.access_token);
}

async function googleAdsRequest<T>(
  accessToken: string,
  connection: GoogleAdsConnectionRow,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const developerToken = Deno.env.get("GOOGLE_DEVELOPER_TOKEN");
  if (!developerToken) {
    throw new Error("Secret GOOGLE_DEVELOPER_TOKEN não configurada");
  }

  const headers = new Headers(init?.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("developer-token", developerToken);
  headers.set("Content-Type", "application/json");

  const loginCustomerId = normalizeCustomerId(connection.login_customer_id);
  if (loginCustomerId) {
    headers.set("login-customer-id", loginCustomerId);
  }

  const response = await fetch(`${GOOGLE_ADS_API_BASE}${path}`, {
    ...init,
    headers,
  });

  const data = await response.json();
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error?.details?.[0]?.errors?.[0]?.message ||
      "Erro na API do Google Ads";
    throw new Error(message);
  }

  return data as T;
}

async function listAccessibleCustomers(accessToken: string, connection: GoogleAdsConnectionRow) {
  const accessible = await googleAdsRequest<{ resourceNames?: string[] }>(
    accessToken,
    connection,
    "/customers:listAccessibleCustomers",
    { method: "GET" },
  );

  const customerIds = (accessible.resourceNames || [])
    .map((name) => String(name).split("/").pop() || "")
    .map(normalizeCustomerId)
    .filter(Boolean);

  const customers: Array<{ id: string; name: string; currencyCode: string | null; timeZone: string | null }> = [];

  for (const customerId of customerIds) {
    try {
      const details = await googleAdsRequest<Array<{ results?: Array<{ customer?: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string } }> }>>(
        accessToken,
        connection,
        `/customers/${customerId}/googleAds:searchStream`,
        {
          method: "POST",
          body: JSON.stringify({
            query:
              "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1",
          }),
        },
      );

      const customer = details?.[0]?.results?.[0]?.customer;
      customers.push({
        id: customerId,
        name: String(customer?.descriptiveName || customerId),
        currencyCode: customer?.currencyCode || null,
        timeZone: customer?.timeZone || null,
        loginCustomerId: connection.login_customer_id,
      });
    } catch {
      customers.push({
        id: customerId,
        name: customerId,
        currencyCode: null,
        timeZone: null,
        loginCustomerId: connection.login_customer_id,
      });
    }
  }

  return customers;
}

async function validateCustomer(accessToken: string, connection: GoogleAdsConnectionRow) {
  const customerId = normalizeCustomerId(connection.customer_id);
  if (!customerId) {
    throw new Error("customer_id inválido");
  }

  const details = await googleAdsRequest<Array<{ results?: Array<{ customer?: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string } }> }>>(
    accessToken,
    connection,
    `/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      body: JSON.stringify({
        query:
          "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1",
      }),
    },
  );

  const customer = details?.[0]?.results?.[0]?.customer;
  if (!customer?.id) {
    throw new Error("Não foi possível validar a conta Google Ads informada");
  }

  return {
    id: normalizeCustomerId(String(customer.id)),
    name: String(customer.descriptiveName || customer.id),
    currencyCode: customer.currencyCode || null,
    timeZone: customer.timeZone || null,
    loginCustomerId: connection.login_customer_id,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = String(claimsData.claims.sub);
    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.projectId || "").trim();
    if (!projectId) {
      throw new Error("projectId é obrigatório");
    }

    const { data: connection, error: connectionError } = await adminClient
      .from("project_google_ads_connections")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .single();

    if (connectionError || !connection) {
      return new Response(JSON.stringify({ error: "Conexão do Google Ads não encontrada para este projeto" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const typedConnection = connection as GoogleAdsConnectionRow;
    const accessToken = await refreshAccessToken(typedConnection);

    if (action === "list-accessible-customers") {
      const customers = await listAccessibleCustomers(accessToken, typedConnection);
      return new Response(JSON.stringify({ customers }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "validate-connection") {
      const customer = await validateCustomer(accessToken, typedConnection);

      await adminClient
        .from("project_google_ads_connections")
        .update({
          customer_id: customer.id,
          customer_name: customer.name,
          currency_code: customer.currencyCode,
          time_zone: customer.timeZone,
          last_validated_at: new Date().toISOString(),
        })
        .eq("project_id", projectId)
        .eq("user_id", userId);

      return new Response(JSON.stringify({ customer, valid: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || "Unexpected error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
