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
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com/v20";
const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

const normalizeCustomerId = (value: string | null | undefined) =>
  String(value || "").replace(/\D/g, "");

function base64UrlEncode(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getOriginFromRequest(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");

  const referer = req.headers.get("referer");
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function getGoogleCredentials() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Secrets GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nao configuradas");
  }
  return { clientId, clientSecret };
}

function getGoogleAdsRedirectUri(req: Request) {
  const configured = Deno.env.get("GOOGLE_ADS_REDIRECT_URI");
  if (configured) return configured;

  const origin = getOriginFromRequest(req);
  if (!origin) {
    throw new Error("Nao foi possivel determinar o redirect URI do Google Ads");
  }

  return `${origin}/app/google-ads/callback`;
}

async function getAuthenticatedUser(
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string | null,
) {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing authorization");
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
    throw new Error("Invalid or expired token");
  }
  return user;
}

async function assertProjectOwner(adminClient: ReturnType<typeof createClient>, projectId: string, userId: string) {
  const { data, error } = await adminClient
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Projeto nao encontrado para este usuario");
  }
}

async function exchangeGoogleAuthCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getGoogleCredentials();
  const response = await fetch(GOOGLE_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Falha ao conectar Google Ads");
  }

  return data as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
}

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

async function fetchInsights(
  accessToken: string,
  connection: GoogleAdsConnectionRow,
  startDate: string,
  endDate: string,
) {
  const customerId = normalizeCustomerId(connection.customer_id);
  if (!customerId) {
    throw new Error("customer_id não configurado. Configure o Google Ads no painel do projeto.");
  }

  const query = [
    "SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions",
    "FROM campaign",
    `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
    "AND campaign.status != 'REMOVED'",
  ].join(" ");

  const response = await googleAdsRequest<Array<{
    results?: Array<{
      metrics?: {
        costMicros?: string;
        impressions?: string;
        clicks?: string;
        conversions?: number;
      };
    }>;
  }>>(
    accessToken,
    connection,
    `/customers/${customerId}/googleAds:searchStream`,
    { method: "POST", body: JSON.stringify({ query }) },
  );

  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;

  const batches = Array.isArray(response) ? response : [response];
  for (const batch of batches) {
    for (const result of batch.results || []) {
      spend += Number(result.metrics?.costMicros || 0) / 1_000_000;
      impressions += Number(result.metrics?.impressions || 0);
      clicks += Number(result.metrics?.clicks || 0);
      conversions += Number(result.metrics?.conversions || 0);
    }
  }

  return { spend, impressions, clicks, conversions };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const authHeader = req.headers.get("Authorization");
    const shareTokenHeader = req.headers.get("x-share-token");

    const body = await req.json().catch(() => ({}));
    const requestProjectId = String(body?.projectId || "").trim();

    if (action === "authorize") {
      const user = await getAuthenticatedUser(supabaseUrl, supabaseAnonKey, authHeader);
      if (!requestProjectId) throw new Error("projectId e obrigatorio");
      await assertProjectOwner(adminClient, requestProjectId, user.id);

      const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
      if (!clientId) throw new Error("Secret GOOGLE_CLIENT_ID nao configurada");

      const redirectUri = getGoogleAdsRedirectUri(req);
      const scope = Deno.env.get("GOOGLE_ADS_SCOPES") || GOOGLE_ADS_SCOPE;
      const returnTo = String(body?.returnTo || `/app/projects/${requestProjectId}/config?step=2`);
      const state = base64UrlEncode(JSON.stringify({ projectId: requestProjectId, returnTo }));

      const googleAuthUrl = new URL(GOOGLE_AUTH_URL);
      googleAuthUrl.searchParams.set("client_id", clientId);
      googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
      googleAuthUrl.searchParams.set("response_type", "code");
      googleAuthUrl.searchParams.set("scope", scope);
      googleAuthUrl.searchParams.set("access_type", "offline");
      googleAuthUrl.searchParams.set("prompt", "consent select_account");
      googleAuthUrl.searchParams.set("include_granted_scopes", "true");
      googleAuthUrl.searchParams.set("state", state);

      return new Response(JSON.stringify({ url: googleAuthUrl.toString(), redirect_uri: redirectUri, scope }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "callback") {
      const user = await getAuthenticatedUser(supabaseUrl, supabaseAnonKey, authHeader);
      const code = String(body?.code || "").trim();
      if (!code) throw new Error("Codigo de autorizacao ausente");

      let stateProjectId = "";
      try {
        const decoded = JSON.parse(base64UrlDecode(String(body?.state || "")));
        stateProjectId = String(decoded?.projectId || "").trim();
      } catch {
        stateProjectId = "";
      }

      const callbackProjectId = requestProjectId || stateProjectId;
      if (!callbackProjectId) throw new Error("projectId e obrigatorio");
      await assertProjectOwner(adminClient, callbackProjectId, user.id);

      const redirectUri = getGoogleAdsRedirectUri(req);
      const tokenData = await exchangeGoogleAuthCode(code, redirectUri);

      const { data: existingConnection } = await adminClient
        .from("project_google_ads_connections")
        .select("refresh_token, customer_id, login_customer_id, customer_name, currency_code, time_zone")
        .eq("project_id", callbackProjectId)
        .eq("user_id", user.id)
        .maybeSingle();

      const refreshToken = tokenData.refresh_token || existingConnection?.refresh_token;
      if (!refreshToken) {
        throw new Error("O Google nao retornou refresh_token. Tente conectar novamente com consentimento.");
      }

      const { error: upsertError } = await adminClient
        .from("project_google_ads_connections")
        .upsert(
          {
            project_id: callbackProjectId,
            user_id: user.id,
            refresh_token: refreshToken,
            customer_id: existingConnection?.customer_id ?? null,
            login_customer_id: existingConnection?.login_customer_id ?? null,
            customer_name: existingConnection?.customer_name ?? null,
            currency_code: existingConnection?.currency_code ?? null,
            time_zone: existingConnection?.time_zone ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "project_id" },
        );

      if (upsertError) throw upsertError;

      return new Response(JSON.stringify({ success: true, projectId: callbackProjectId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const projectId = String(body?.projectId || "").trim();
    if (!projectId) throw new Error("projectId é obrigatório");

    // Auth: share token OR user JWT
    let userId: string | null = null;

    if (shareTokenHeader) {
      const { data: tokenRow } = await adminClient
        .from("share_tokens")
        .select("project_id")
        .eq("token", shareTokenHeader.trim())
        .eq("is_active", true)
        .single();

      if (!tokenRow || tokenRow.project_id !== projectId) {
        return new Response(JSON.stringify({ error: "Token de compartilhamento inválido" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // userId stays null — share token path bypasses user ownership check
    } else if (authHeader?.startsWith("Bearer ")) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    } else {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch Google Ads connection
    let connectionQuery = adminClient
      .from("project_google_ads_connections")
      .select("*")
      .eq("project_id", projectId);

    if (userId) {
      connectionQuery = connectionQuery.eq("user_id", userId);
    }

    const { data: connection, error: connectionError } = await connectionQuery.single();

    if (connectionError || !connection) {
      return new Response(JSON.stringify({ error: "Conexão do Google Ads não encontrada para este projeto" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const typedConnection = connection as GoogleAdsConnectionRow;
    const accessToken = await refreshAccessToken(typedConnection);

    if (action === "insights") {
      const startDate = String(body?.startDate || "").trim();
      const endDate = String(body?.endDate || "").trim();
      if (!startDate || !endDate) throw new Error("startDate e endDate são obrigatórios");

      const totals = await fetchInsights(accessToken, typedConnection, startDate, endDate);
      return new Response(JSON.stringify({ totals }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "portal-overview") {
      const startDate = String(body?.startDate || "").trim();
      const endDate = String(body?.endDate || "").trim();
      if (!startDate || !endDate) throw new Error("startDate e endDate são obrigatórios");

      const customerId = normalizeCustomerId(typedConnection.customer_id);
      if (!customerId) throw new Error("customer_id não configurado. Configure o Google Ads no painel do projeto.");

      const timeseriesQuery = [
        "SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions",
        "FROM campaign",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
      ].join(" ");

      const campaignsQuery = [
        "SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions,",
        "metrics.unique_users, metrics.average_impression_frequency_per_user, metrics.average_cpv, metrics.video_views,",
        "metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate",
        "FROM campaign",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
      ].join(" ");

      type BatchResult = Array<{
        results?: Array<{
          segments?: { date?: string };
          campaign?: { id?: string; name?: string };
          metrics?: {
            costMicros?: string;
            impressions?: string;
            clicks?: string;
            conversions?: number;
            uniqueUsers?: string;
            averageImpressionFrequencyPerUser?: number;
            averageCpv?: number;
            videoViews?: string;
            videoQuartileP25Rate?: number;
            videoQuartileP50Rate?: number;
            videoQuartileP75Rate?: number;
            videoQuartileP100Rate?: number;
          };
        }>;
      }>;

      const [tsRes, campRes] = await Promise.all([
        googleAdsRequest<BatchResult>(accessToken, typedConnection, `/customers/${customerId}/googleAds:searchStream`, {
          method: "POST",
          body: JSON.stringify({ query: timeseriesQuery }),
        }),
        googleAdsRequest<BatchResult>(accessToken, typedConnection, `/customers/${customerId}/googleAds:searchStream`, {
          method: "POST",
          body: JSON.stringify({ query: campaignsQuery }),
        }),
      ]);

      const byDate = new Map<string, { date: string; spend: number; conversions: number; impressions: number; clicks: number }>();
      for (const batch of (Array.isArray(tsRes) ? tsRes : [tsRes])) {
        for (const result of (batch.results || [])) {
          const date = String(result.segments?.date || "");
          if (!date) continue;
          const cur = byDate.get(date) || { date, spend: 0, conversions: 0, impressions: 0, clicks: 0 };
          cur.spend += Number(result.metrics?.costMicros || 0) / 1_000_000;
          cur.conversions += Number(result.metrics?.conversions || 0);
          cur.impressions += Number(result.metrics?.impressions || 0);
          cur.clicks += Number(result.metrics?.clicks || 0);
          byDate.set(date, cur);
        }
      }
      const timeseries = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

      const byCampaign = new Map<string, {
        id: string;
        name: string;
        spend: number;
        conversions: number;
        impressions: number;
        clicks: number;
        uniqueUsers: number;
        averageFrequency: number;
        averageCpv: number;
        videoViews: number;
        videoQuartile25: number;
        videoQuartile50: number;
        videoQuartile75: number;
        videoQuartile100: number;
      }>();
      for (const batch of (Array.isArray(campRes) ? campRes : [campRes])) {
        for (const result of (batch.results || [])) {
          const id = String(result.campaign?.id || "");
          if (!id) continue;
          const name = String(result.campaign?.name || id);
          const videoViews = Number(result.metrics?.videoViews || 0);
          const quartile25Rate = Number(result.metrics?.videoQuartileP25Rate || 0);
          const quartile50Rate = Number(result.metrics?.videoQuartileP50Rate || 0);
          const quartile75Rate = Number(result.metrics?.videoQuartileP75Rate || 0);
          const quartile100Rate = Number(result.metrics?.videoQuartileP100Rate || 0);
          const cur = byCampaign.get(id) || {
            id,
            name,
            spend: 0,
            conversions: 0,
            impressions: 0,
            clicks: 0,
            uniqueUsers: 0,
            averageFrequency: 0,
            averageCpv: 0,
            videoViews: 0,
            videoQuartile25: 0,
            videoQuartile50: 0,
            videoQuartile75: 0,
            videoQuartile100: 0,
          };
          cur.spend += Number(result.metrics?.costMicros || 0) / 1_000_000;
          cur.conversions += Number(result.metrics?.conversions || 0);
          cur.impressions += Number(result.metrics?.impressions || 0);
          cur.clicks += Number(result.metrics?.clicks || 0);
          cur.uniqueUsers += Number(result.metrics?.uniqueUsers || 0);
          cur.averageFrequency = Number(result.metrics?.averageImpressionFrequencyPerUser || cur.averageFrequency || 0);
          cur.averageCpv = Number(result.metrics?.averageCpv || cur.averageCpv || 0);
          cur.videoViews += videoViews;
          cur.videoQuartile25 += videoViews > 0 ? videoViews * (quartile25Rate / 100) : 0;
          cur.videoQuartile50 += videoViews > 0 ? videoViews * (quartile50Rate / 100) : 0;
          cur.videoQuartile75 += videoViews > 0 ? videoViews * (quartile75Rate / 100) : 0;
          cur.videoQuartile100 += videoViews > 0 ? videoViews * (quartile100Rate / 100) : 0;
          byCampaign.set(id, cur);
        }
      }
      const campaigns = Array.from(byCampaign.values())
        .filter((c) => c.spend > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          spend: c.spend,
          impressions: c.impressions,
          clicks: c.clicks,
          ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
          averageCpc: c.clicks > 0 ? c.spend / c.clicks : 0,
          conversions: c.conversions,
          costPerConversion: c.conversions > 0 ? c.spend / c.conversions : 0,
          uniqueUsers: c.uniqueUsers,
          averageFrequency: c.averageFrequency,
          averageCpv: c.averageCpv,
          videoViews: c.videoViews,
          videoQuartile25: c.videoQuartile25,
          videoQuartile50: c.videoQuartile50,
          videoQuartile75: c.videoQuartile75,
          videoQuartile100: c.videoQuartile100,
        }))
        .sort((a, b) => b.spend - a.spend);

      const totals = timeseries.reduce(
        (acc, r) => ({ spend: acc.spend + r.spend, conversions: acc.conversions + r.conversions, impressions: acc.impressions + r.impressions }),
        { spend: 0, conversions: 0, impressions: 0 },
      );

      return new Response(JSON.stringify({ timeseries, campaigns, totals }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        .eq("user_id", userId ?? "");

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
