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

const normalizeComparisonText = (value: string | null | undefined) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const looksLikeYouTubeVideoId = (value: string | null | undefined) =>
  /^[a-zA-Z0-9_-]{11}$/.test(String(value || "").trim());

const looksLikeNumericId = (value: string | null | undefined) =>
  /^\d+$/.test(String(value || "").trim());

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
  const clientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID") || Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET") || Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Secrets GOOGLE_ADS_CLIENT_ID/SECRET ou GOOGLE_CLIENT_ID/SECRET nao configuradas");
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
  const clientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID") || Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET") || Deno.env.get("GOOGLE_CLIENT_SECRET");
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
    const googleAdsError = data?.error?.details?.[0]?.errors?.[0];
    const message =
      data?.error?.message ||
      googleAdsError?.message ||
      (googleAdsError?.errorCode ? JSON.stringify(googleAdsError.errorCode) : "") ||
      "Erro na API do Google Ads";
    console.error("Google Ads API request failed", {
      path,
      status: response.status,
      message,
      error: data?.error,
    });
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

  const customersById = new Map<string, {
    id: string;
    name: string;
    currencyCode: string | null;
    timeZone: string | null;
    loginCustomerId: string | null;
  }>();

  const upsertCustomer = (customer: {
    id: string;
    name?: string | null;
    currencyCode?: string | null;
    timeZone?: string | null;
    loginCustomerId?: string | null;
  }) => {
    const id = normalizeCustomerId(customer.id);
    if (!id) return;

    const current = customersById.get(id);
    customersById.set(id, {
      id,
      name: String(customer.name || current?.name || id),
      currencyCode: customer.currencyCode ?? current?.currencyCode ?? null,
      timeZone: customer.timeZone ?? current?.timeZone ?? null,
      loginCustomerId: customer.loginCustomerId ?? current?.loginCustomerId ?? connection.login_customer_id ?? null,
    });
  };

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
      upsertCustomer({
        id: customerId,
        name: String(customer?.descriptiveName || customerId),
        currencyCode: customer?.currencyCode || null,
        timeZone: customer?.timeZone || null,
        loginCustomerId: connection.login_customer_id,
      });
    } catch {
      upsertCustomer({
        id: customerId,
        name: customerId,
        currencyCode: null,
        timeZone: null,
        loginCustomerId: connection.login_customer_id,
      });
    }

    try {
      const hierarchy = await googleAdsRequest<Array<{
        results?: Array<{
          customerClient?: {
            id?: string;
            descriptiveName?: string;
            currencyCode?: string;
            timeZone?: string;
            level?: number;
          };
        }>;
      }>>(
        accessToken,
        connection,
        `/customers/${customerId}/googleAds:searchStream`,
        {
          method: "POST",
          body: JSON.stringify({
            query: [
              "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,",
              "customer_client.time_zone, customer_client.level",
              "FROM customer_client",
              "WHERE customer_client.level <= 1",
            ].join(" "),
          }),
        },
      );

      for (const batch of hierarchy || []) {
        for (const row of batch.results || []) {
          const client = row.customerClient;
          const clientId = normalizeCustomerId(String(client?.id || ""));
          if (!clientId) continue;

          const isChildOfManager = clientId !== customerId;
          upsertCustomer({
            id: clientId,
            name: client?.descriptiveName || clientId,
            currencyCode: client?.currencyCode || null,
            timeZone: client?.timeZone || null,
            loginCustomerId: isChildOfManager ? customerId : (connection.login_customer_id || null),
          });
        }
      }
    } catch {
      // Some accessible accounts are not managers or don't expose hierarchy. Keep the direct lookup result.
    }
  }

  return Array.from(customersById.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
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

      const clientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID") || Deno.env.get("GOOGLE_CLIENT_ID");
      if (!clientId) throw new Error("Secret GOOGLE_ADS_CLIENT_ID ou GOOGLE_CLIENT_ID nao configurada");

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
        "SELECT campaign.id, campaign.name, campaign.advertising_channel_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions,",
        "metrics.unique_users, metrics.average_impression_frequency_per_user, metrics.average_cpv, metrics.video_views,",
        "metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate",
        "FROM campaign",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
      ].join(" ");

      const basicCampaignsQuery = [
        "SELECT campaign.id, campaign.name, campaign.advertising_channel_type,",
        "metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions",
        "FROM campaign",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
      ].join(" ");

      const adsQuery = [
        "SELECT campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,",
        "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions",
        "FROM ad_group_ad",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
        "AND ad_group_ad.status != 'REMOVED'",
      ].join(" ");

      const videoResponsiveAdAssetsQuery = [
        "SELECT campaign.id, ad_group_ad.ad.id, ad_group_ad.ad.video_responsive_ad.videos",
        "FROM ad_group_ad",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
        "AND ad_group_ad.status != 'REMOVED'",
      ].join(" ");

      const demandGenVideoAdDetailsQuery = [
        "SELECT campaign.id, ad_group_ad.ad.id,",
        "ad_group_ad.ad.demand_gen_video_responsive_ad.videos,",
        "ad_group_ad.ad.demand_gen_video_responsive_ad.headlines,",
        "ad_group_ad.ad.demand_gen_video_responsive_ad.long_headlines,",
        "ad_group_ad.ad.demand_gen_video_responsive_ad.business_name",
        "FROM ad_group_ad",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
        "AND ad_group_ad.status != 'REMOVED'",
      ].join(" ");

      const adAssetViewVideosQuery = [
        "SELECT campaign.id, ad_group_ad.ad.id, ad_group_ad_asset_view.field_type,",
        "asset.resource_name, asset.name, asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title",
        "FROM ad_group_ad_asset_view",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
        "AND ad_group_ad.status != 'REMOVED'",
        "AND ad_group_ad_asset_view.field_type IN ('VIDEO', 'YOUTUBE_VIDEO')",
      ].join(" ");

      const adsFallbackQuery = [
        "SELECT campaign.id, campaign.name, ad_group_ad.ad.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions",
        "FROM ad_group_ad",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
        "AND ad_group_ad.status != 'REMOVED'",
      ].join(" ");

      const videoAdsQuery = [
        "SELECT campaign.id, campaign.name, video.id, video.title,",
        "metrics.cost_micros, metrics.impressions, metrics.trueview_average_cpv, metrics.video_trueview_views,",
        "metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate",
        "FROM video",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
        "AND campaign.advertising_channel_type = 'VIDEO'",
      ].join(" ");

      const videoAdAssetsFallbackQuery = [
        "SELECT campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.video_responsive_ad.videos,",
        "metrics.cost_micros, metrics.impressions, metrics.trueview_average_cpv, metrics.video_trueview_views,",
        "metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate",
        "FROM ad_group_ad",
        `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        "AND campaign.status != 'REMOVED'",
        "AND campaign.advertising_channel_type = 'VIDEO'",
      ].join(" ");

      const videoAssetsQuery = [
        "SELECT asset.resource_name, asset.id, asset.name, asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title, asset.type",
        "FROM asset",
        "WHERE asset.type = 'YOUTUBE_VIDEO'",
      ].join(" ");

      type BatchResult = Array<{
        results?: Array<{
          segments?: { date?: string };
          campaign?: { id?: string; name?: string; advertisingChannelType?: string };
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

      type VideoAdsBatchResult = Array<{
        results?: Array<{
          campaign?: { id?: string; name?: string };
          video?: { id?: string; title?: string };
          metrics?: {
            costMicros?: string;
            impressions?: string;
            trueviewAverageCpv?: number;
            videoTrueviewViews?: string;
            videoQuartileP25Rate?: number;
            videoQuartileP50Rate?: number;
            videoQuartileP75Rate?: number;
            videoQuartileP100Rate?: number;
          };
        }>;
      }>;

      type AdsBatchResult = Array<{
        results?: Array<{
          campaign?: { id?: string; name?: string };
          adGroupAd?: {
            ad?: {
              id?: string;
              name?: string;
              type?: string;
              finalUrls?: string[];
            };
          };
          metrics?: {
            costMicros?: string;
            impressions?: string;
            clicks?: string;
            conversions?: number;
          };
        }>;
      }>;

      type AdCreativeDetailsBatchResult = Array<{
        results?: Array<{
          campaign?: { id?: string; name?: string };
          adGroupAd?: {
            ad?: {
              id?: string;
              videoResponsiveAd?: {
                videos?: Array<{ asset?: string }>;
              };
              demandGenVideoResponsiveAd?: {
                videos?: Array<{ asset?: string }>;
                headlines?: Array<{ text?: string }>;
                longHeadlines?: Array<{ text?: string }>;
                businessName?: { text?: string };
              };
            };
          };
        }>;
      }>;

      type AdAssetViewVideosBatchResult = Array<{
        results?: Array<{
          campaign?: { id?: string; name?: string };
          adGroupAd?: {
            ad?: {
              id?: string;
            };
          };
          adGroupAdAssetView?: {
            fieldType?: string;
          };
          asset?: {
            resourceName?: string;
            name?: string;
            youtubeVideoAsset?: {
              youtubeVideoId?: string;
              youtubeVideoTitle?: string;
            };
          };
        }>;
      }>;

      type VideoAdAssetsFallbackBatchResult = Array<{
        results?: Array<{
          campaign?: { id?: string; name?: string };
          adGroupAd?: {
            ad?: {
              id?: string;
              videoResponsiveAd?: {
                videos?: Array<{ asset?: string }>;
              };
            };
          };
          metrics?: {
            costMicros?: string;
            impressions?: string;
            trueviewAverageCpv?: number;
            videoTrueviewViews?: string;
            videoQuartileP25Rate?: number;
            videoQuartileP50Rate?: number;
            videoQuartileP75Rate?: number;
            videoQuartileP100Rate?: number;
          };
        }>;
      }>;

      type VideoAssetBatchResult = Array<{
        results?: Array<{
          asset?: {
            resourceName?: string;
            id?: string;
            name?: string;
            youtubeVideoAsset?: { youtubeVideoId?: string; youtubeVideoTitle?: string };
            type?: string;
          };
        }>;
      }>;

      const tsRes = await googleAdsRequest<BatchResult>(
        accessToken,
        typedConnection,
        `/customers/${customerId}/googleAds:searchStream`,
        {
          method: "POST",
          body: JSON.stringify({ query: timeseriesQuery }),
        },
      );

      let campRes: BatchResult = [];
      try {
        campRes = await googleAdsRequest<BatchResult>(
          accessToken,
          typedConnection,
          `/customers/${customerId}/googleAds:searchStream`,
          {
            method: "POST",
            body: JSON.stringify({ query: campaignsQuery }),
          },
        );
      } catch (error) {
        console.error("Google Ads rich campaigns query failed, retrying basic query", error);
        campRes = await googleAdsRequest<BatchResult>(
          accessToken,
          typedConnection,
          `/customers/${customerId}/googleAds:searchStream`,
          {
            method: "POST",
            body: JSON.stringify({ query: basicCampaignsQuery }),
          },
        );
      }

      let adsRes: AdsBatchResult = [];
      try {
        adsRes = await googleAdsRequest<AdsBatchResult>(
          accessToken,
          typedConnection,
          `/customers/${customerId}/googleAds:searchStream`,
          {
            method: "POST",
            body: JSON.stringify({ query: adsQuery }),
          },
        );
      } catch (error) {
        console.error("Google Ads ads query failed", error);
        try {
          adsRes = await googleAdsRequest<AdsBatchResult>(
            accessToken,
            typedConnection,
            `/customers/${customerId}/googleAds:searchStream`,
            {
              method: "POST",
              body: JSON.stringify({ query: adsFallbackQuery }),
            },
          );
        } catch (fallbackError) {
          console.error("Google Ads ads fallback query failed", fallbackError);
        }
      }

      let videoAdsRes: VideoAdsBatchResult = [];
      try {
        videoAdsRes = await googleAdsRequest<VideoAdsBatchResult>(
          accessToken,
          typedConnection,
          `/customers/${customerId}/googleAds:searchStream`,
          {
            method: "POST",
            body: JSON.stringify({ query: videoAdsQuery }),
          },
        );
      } catch (error) {
        console.error("Google Ads video ads query failed", error);
      }

      let fallbackVideoAdsRes: VideoAdAssetsFallbackBatchResult = [];
      try {
        fallbackVideoAdsRes = await googleAdsRequest<VideoAdAssetsFallbackBatchResult>(
          accessToken,
          typedConnection,
          `/customers/${customerId}/googleAds:searchStream`,
          {
            method: "POST",
            body: JSON.stringify({ query: videoAdAssetsFallbackQuery }),
          },
        );
      } catch (error) {
        console.error("Google Ads video asset fallback query failed", error);
      }

      let videoAssetMap = new Map<string, { title: string; youtubeVideoId: string; youtubeUrl: string; thumbnailUrl: string }>();
      const videoAssetByNormalizedTitle = new Map<string, { title: string; youtubeVideoId: string; youtubeUrl: string; thumbnailUrl: string }>();
      try {
        const videoAssetsRes = await googleAdsRequest<VideoAssetBatchResult>(
          accessToken,
          typedConnection,
          `/customers/${customerId}/googleAds:searchStream`,
          {
            method: "POST",
            body: JSON.stringify({ query: videoAssetsQuery }),
          },
        );
        for (const batch of (Array.isArray(videoAssetsRes) ? videoAssetsRes : [videoAssetsRes])) {
          for (const result of (batch.results || [])) {
            const resourceName = String(result.asset?.resourceName || "");
            const youtubeVideoId = String(result.asset?.youtubeVideoAsset?.youtubeVideoId || "");
            if (!resourceName || !youtubeVideoId) continue;
            const assetData = {
              title: String(result.asset?.youtubeVideoAsset?.youtubeVideoTitle || result.asset?.name || youtubeVideoId),
              youtubeVideoId,
              youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
              thumbnailUrl: `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`,
            };
            videoAssetMap.set(resourceName, assetData);
            const normalizedTitle = normalizeComparisonText(assetData.title);
            if (normalizedTitle && !videoAssetByNormalizedTitle.has(normalizedTitle)) {
              videoAssetByNormalizedTitle.set(normalizedTitle, assetData);
            }
          }
        }
      } catch (error) {
        console.error("Google Ads asset lookup for videos failed", error);
      }

      const adCreativeDetails = new Map<string, {
        title?: string;
        youtubeVideoId?: string;
        youtubeUrl?: string;
        thumbnailUrl?: string;
      }>();

      const mergeAdCreativeDetails = (adId: string, details: {
        title?: string;
        youtubeVideoId?: string;
        youtubeUrl?: string;
        thumbnailUrl?: string;
      }) => {
        if (!adId) return;
        const current = adCreativeDetails.get(adId) || {};
        adCreativeDetails.set(adId, {
          title: current.title || details.title,
          youtubeVideoId: current.youtubeVideoId || details.youtubeVideoId,
          youtubeUrl: current.youtubeUrl || details.youtubeUrl,
          thumbnailUrl: current.thumbnailUrl || details.thumbnailUrl,
        });
      };

      const readAdCreativeDetails = (result: {
        adGroupAd?: {
          ad?: {
            id?: string;
            videoResponsiveAd?: { videos?: Array<{ asset?: string }> };
            demandGenVideoResponsiveAd?: {
              videos?: Array<{ asset?: string }>;
              headlines?: Array<{ text?: string }>;
              longHeadlines?: Array<{ text?: string }>;
              businessName?: { text?: string };
            };
          };
        };
      }) => {
        const adId = String(result.adGroupAd?.ad?.id || "");
        const demandGenAd = result.adGroupAd?.ad?.demandGenVideoResponsiveAd;
        const adVideoAssets = [
          ...(result.adGroupAd?.ad?.videoResponsiveAd?.videos || []),
          ...(demandGenAd?.videos || []),
        ];
        const matchedAsset = adVideoAssets
          .map((assetRef) => videoAssetMap.get(String(assetRef?.asset || "")))
          .find(Boolean);
        const title = [
          String(demandGenAd?.longHeadlines?.[0]?.text || "").trim(),
          String(demandGenAd?.headlines?.[0]?.text || "").trim(),
          matchedAsset?.title || "",
          String(demandGenAd?.businessName?.text || "").trim(),
        ].find((value) => String(value || "").trim());
        mergeAdCreativeDetails(adId, {
          title,
          youtubeVideoId: matchedAsset?.youtubeVideoId,
          youtubeUrl: matchedAsset?.youtubeUrl,
          thumbnailUrl: matchedAsset?.thumbnailUrl,
        });
      };

      for (const query of [videoResponsiveAdAssetsQuery, demandGenVideoAdDetailsQuery]) {
        try {
          const detailsRes = await googleAdsRequest<AdCreativeDetailsBatchResult>(
            accessToken,
            typedConnection,
            `/customers/${customerId}/googleAds:searchStream`,
            {
              method: "POST",
              body: JSON.stringify({ query }),
            },
          );
          for (const batch of (Array.isArray(detailsRes) ? detailsRes : [detailsRes])) {
            for (const result of (batch.results || [])) {
              readAdCreativeDetails(result);
            }
          }
        } catch (error) {
          console.error("Google Ads ad creative details query failed", error);
        }
      }

      try {
        const assetViewRes = await googleAdsRequest<AdAssetViewVideosBatchResult>(
          accessToken,
          typedConnection,
          `/customers/${customerId}/googleAds:searchStream`,
          {
            method: "POST",
            body: JSON.stringify({ query: adAssetViewVideosQuery }),
          },
        );
        for (const batch of (Array.isArray(assetViewRes) ? assetViewRes : [assetViewRes])) {
          for (const result of (batch.results || [])) {
            const adId = String(result.adGroupAd?.ad?.id || "");
            const youtubeVideoId = String(result.asset?.youtubeVideoAsset?.youtubeVideoId || "");
            if (!adId || !youtubeVideoId) continue;
            const title = String(result.asset?.youtubeVideoAsset?.youtubeVideoTitle || result.asset?.name || "").trim();
            mergeAdCreativeDetails(adId, {
              title: title || undefined,
              youtubeVideoId,
              youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
              thumbnailUrl: `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`,
            });
          }
        }
      } catch (error) {
        console.error("Google Ads ad asset view video query failed", error);
      }

      if (!videoAdsRes.length && fallbackVideoAdsRes.length) {
        videoAdsRes = fallbackVideoAdsRes.map((batch) => ({
          results: (batch.results || []).flatMap((result) => {
            const assets = result.adGroupAd?.ad?.videoResponsiveAd?.videos || [];
            return assets.map((assetRef) => {
              const assetName = String(assetRef?.asset || "");
              const assetData = videoAssetMap.get(assetName);
              return {
                campaign: result.campaign,
                video: {
                  id: assetData?.youtubeVideoId || assetName,
                  title: assetData?.title || assetName,
                },
                metrics: result.metrics,
              };
            });
          }),
        }));
      }

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
        campaignType: string;
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
          const campaignType = String(result.campaign?.advertisingChannelType || "");
          const videoViews = Number(result.metrics?.videoViews || 0);
          const quartile25Rate = Number(result.metrics?.videoQuartileP25Rate || 0);
          const quartile50Rate = Number(result.metrics?.videoQuartileP50Rate || 0);
          const quartile75Rate = Number(result.metrics?.videoQuartileP75Rate || 0);
          const quartile100Rate = Number(result.metrics?.videoQuartileP100Rate || 0);
          const cur = byCampaign.get(id) || {
            id,
            name,
            campaignType,
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
          cur.averageCpv = Number(result.metrics?.averageCpv || 0) / 1_000_000 || cur.averageCpv || 0;
          cur.videoViews += videoViews;
          cur.videoQuartile25 += videoViews > 0 ? videoViews * quartile25Rate : 0;
          cur.videoQuartile50 += videoViews > 0 ? videoViews * quartile50Rate : 0;
          cur.videoQuartile75 += videoViews > 0 ? videoViews * quartile75Rate : 0;
          cur.videoQuartile100 += videoViews > 0 ? videoViews * quartile100Rate : 0;
          byCampaign.set(id, cur);
        }
      }
      const campaigns = Array.from(byCampaign.values())
        .filter((c) => c.spend > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          campaignType: c.campaignType,
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

      const adsByCampaign = new Map<string, Array<{
        id: string;
        title: string;
        adType?: string;
        link?: string;
        thumbnailUrl?: string;
        youtubeVideoId?: string;
        youtubeUrl?: string;
        spend: number;
        impressions: number;
        uniqueUsers: number;
        averageFrequency: number;
        averageCpv: number;
        videoViews: number;
        videoQuartile25: number;
        videoQuartile50: number;
        videoQuartile75: number;
        videoQuartile100: number;
        clicks: number;
        conversions: number;
        averageCpc: number;
      }>>();

      const adAgg = new Map<string, {
        campaignId: string;
        id: string;
        title: string;
        adType?: string;
        link?: string;
        thumbnailUrl?: string;
        youtubeVideoId?: string;
        youtubeUrl?: string;
        spend: number;
        impressions: number;
        uniqueUsers: number;
        averageFrequency: number;
        averageCpv: number;
        videoViews: number;
        videoQuartile25: number;
        videoQuartile50: number;
        videoQuartile75: number;
        videoQuartile100: number;
        clicks: number;
        conversions: number;
        averageCpc: number;
      }>();

      for (const batch of (Array.isArray(adsRes) ? adsRes : [adsRes])) {
        for (const result of (batch.results || [])) {
          const campaignId = String(result.campaign?.id || "");
          const adId = String(result.adGroupAd?.ad?.id || "");
          if (!campaignId || !adId) continue;

          const spend = Number(result.metrics?.costMicros || 0) / 1_000_000;
          const impressions = Number(result.metrics?.impressions || 0);
          const clicks = Number(result.metrics?.clicks || 0);
          const conversions = Number(result.metrics?.conversions || 0);
          const finalUrls = Array.isArray(result.adGroupAd?.ad?.finalUrls) ? result.adGroupAd?.ad?.finalUrls : [];
          const link = String(finalUrls?.[0] || "");
          const adType = String(result.adGroupAd?.ad?.type || "");
          const creativeDetails = adCreativeDetails.get(adId);
          const adName = String(result.adGroupAd?.ad?.name || "").trim();
          const title = [
            !looksLikeNumericId(adName) ? adName : "",
            creativeDetails?.title || "",
            looksLikeNumericId(adId) ? "Anuncio sem nome no Google Ads" : adId,
          ].find((value) => String(value || "").trim()) || adId;

          const current = adAgg.get(adId) || {
            campaignId,
            id: adId,
            title,
            adType,
            link: creativeDetails?.youtubeUrl || link || undefined,
            thumbnailUrl: creativeDetails?.thumbnailUrl,
            youtubeVideoId: creativeDetails?.youtubeVideoId,
            youtubeUrl: creativeDetails?.youtubeUrl,
            spend: 0,
            impressions: 0,
            uniqueUsers: 0,
            averageFrequency: 0,
            averageCpv: 0,
            videoViews: 0,
            videoQuartile25: 0,
            videoQuartile50: 0,
            videoQuartile75: 0,
            videoQuartile100: 0,
            clicks: 0,
            conversions: 0,
            averageCpc: 0,
          };

          current.spend += spend;
          current.impressions += impressions;
          current.clicks += clicks;
          current.conversions += conversions;
          current.averageCpc = current.clicks > 0 ? current.spend / current.clicks : 0;
          adAgg.set(adId, current);
        }
      }

      const videosByCampaign = new Map<string, Array<{
        id: string;
        title: string;
        youtubeVideoId?: string;
        youtubeUrl?: string;
        thumbnailUrl?: string;
        spend: number;
        impressions: number;
        uniqueUsers: number;
        averageFrequency: number;
        averageCpv: number;
        videoViews: number;
        videoQuartile25: number;
        videoQuartile50: number;
        videoQuartile75: number;
        videoQuartile100: number;
      }>>();

      const videoAgg = new Map<string, {
        campaignId: string;
        videoId: string;
        title: string;
        youtubeVideoId?: string;
        youtubeUrl?: string;
        thumbnailUrl?: string;
        spend: number;
        impressions: number;
        uniqueUsers: number;
        averageFrequency: number;
        averageCpv: number;
        videoViews: number;
        videoQuartile25: number;
        videoQuartile50: number;
        videoQuartile75: number;
        videoQuartile100: number;
      }>();

      for (const batch of (Array.isArray(videoAdsRes) ? videoAdsRes : [videoAdsRes])) {
        for (const result of (batch.results || [])) {
          const campaignId = String(result.campaign?.id || "");
          if (!campaignId) continue;
          const videoId = String(result.video?.id || "");
          if (!videoId) continue;
          const videoTitle = String(result.video?.title || videoId);
          const normalizedVideoTitle = normalizeComparisonText(videoTitle);
          const matchedAsset =
            videoAssetByNormalizedTitle.get(normalizedVideoTitle) ||
            Array.from(videoAssetByNormalizedTitle.entries()).find(([key]) =>
              key && normalizedVideoTitle && (key.includes(normalizedVideoTitle) || normalizedVideoTitle.includes(key))
            )?.[1];
          const resolvedYoutubeVideoId = matchedAsset?.youtubeVideoId || (looksLikeYouTubeVideoId(videoId) ? videoId : undefined);
          const spend = Number(result.metrics?.costMicros || 0) / 1_000_000;
          const impressions = Number(result.metrics?.impressions || 0);
          const averageCpv = Number(result.metrics?.trueviewAverageCpv || 0) / 1_000_000;
          const videoViews = Number(result.metrics?.videoTrueviewViews || 0);
          const videoQuartile25 = videoViews * Number(result.metrics?.videoQuartileP25Rate || 0);
          const videoQuartile50 = videoViews * Number(result.metrics?.videoQuartileP50Rate || 0);
          const videoQuartile75 = videoViews * Number(result.metrics?.videoQuartileP75Rate || 0);
          const videoQuartile100 = videoViews * Number(result.metrics?.videoQuartileP100Rate || 0);
          const key = `${campaignId}:${videoId}`;
          const current = videoAgg.get(key) || {
            campaignId,
            videoId,
            title: videoTitle,
            youtubeVideoId: resolvedYoutubeVideoId,
            youtubeUrl: matchedAsset?.youtubeUrl || (resolvedYoutubeVideoId ? `https://www.youtube.com/watch?v=${resolvedYoutubeVideoId}` : undefined),
            thumbnailUrl: matchedAsset?.thumbnailUrl || (resolvedYoutubeVideoId ? `https://i.ytimg.com/vi/${resolvedYoutubeVideoId}/hqdefault.jpg` : undefined),
            spend: 0,
            impressions: 0,
            uniqueUsers: 0,
            averageFrequency: 0,
            averageCpv: 0,
            videoViews: 0,
            videoQuartile25: 0,
            videoQuartile50: 0,
            videoQuartile75: 0,
            videoQuartile100: 0,
          };
          current.spend += spend;
          current.impressions += impressions;
          current.averageCpv = averageCpv || current.averageCpv || 0;
          current.videoViews += videoViews;
          current.videoQuartile25 += videoQuartile25;
          current.videoQuartile50 += videoQuartile50;
          current.videoQuartile75 += videoQuartile75;
          current.videoQuartile100 += videoQuartile100;
          videoAgg.set(key, current);
        }
      }

      for (const video of videoAgg.values()) {
        if (video.spend <= 0) continue;
        const current = videosByCampaign.get(video.campaignId) || [];
        current.push(video);
        videosByCampaign.set(video.campaignId, current);
      }

      for (const ad of adAgg.values()) {
        if (ad.spend <= 0) continue;
        if (!ad.thumbnailUrl || !ad.youtubeUrl) {
          const relatedVideos = videosByCampaign.get(ad.campaignId) || [];
          const normalizedAdTitle = normalizeComparisonText(ad.title);
          const matchedVideo =
            relatedVideos.find((video) => normalizeComparisonText(video.title) === normalizedAdTitle) ||
            relatedVideos.find((video) => {
              const normalizedVideoTitle = normalizeComparisonText(video.title);
              return normalizedAdTitle.includes(normalizedVideoTitle) || normalizedVideoTitle.includes(normalizedAdTitle);
            }) ||
            relatedVideos[0];
          if (matchedVideo) {
            ad.thumbnailUrl = ad.thumbnailUrl || matchedVideo.thumbnailUrl;
            ad.youtubeVideoId = ad.youtubeVideoId || matchedVideo.youtubeVideoId;
            ad.youtubeUrl = ad.youtubeUrl || matchedVideo.youtubeUrl;
            ad.link = matchedVideo.youtubeUrl || ad.link;
            if (looksLikeNumericId(ad.title) || ad.title === "Anuncio sem nome no Google Ads") ad.title = matchedVideo.title;
          }
        }
        const current = adsByCampaign.get(ad.campaignId) || [];
        current.push(ad);
        adsByCampaign.set(ad.campaignId, current);
      }

      const campaignsWithVideos = campaigns.map((campaign) => ({
        ...campaign,
        ads: (adsByCampaign.get(campaign.id) || []).sort((a, b) => b.spend - a.spend),
        videos: (videosByCampaign.get(campaign.id) || []).sort((a, b) => b.spend - a.spend),
      }))
        .filter((campaign) => {
          if (String(campaign.campaignType || "").toUpperCase() === "SEARCH") return true;
          return (campaign.ads?.length || 0) > 0 || (campaign.videos?.length || 0) > 0;
        });

      const totals = timeseries.reduce(
        (acc, r) => ({ spend: acc.spend + r.spend, conversions: acc.conversions + r.conversions, impressions: acc.impressions + r.impressions }),
        { spend: 0, conversions: 0, impressions: 0 },
      );

      return new Response(JSON.stringify({ timeseries, campaigns: campaignsWithVideos, totals }), {
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

    if (action === "get-linked-youtube-channel") {
      const customerId = normalizeCustomerId(typedConnection.customer_id);
      if (!customerId) throw new Error("customer_id não configurado na conexão Google Ads");

      // Busca videos usados nas campanhas e extrai o channelId do YouTube
      const query = "SELECT video.channel_id, video.id FROM video WHERE video.channel_id != '' LIMIT 20";
      type VideoResult = Array<{ results?: Array<{ video?: { channelId?: string; id?: string } }> }>;
      const response = await googleAdsRequest<VideoResult>(
        accessToken,
        typedConnection,
        `/customers/${customerId}/googleAds:searchStream`,
        { method: "POST", body: JSON.stringify({ query }) },
      );

      const channelCounts = new Map<string, number>();
      for (const batch of response) {
        for (const row of (batch.results || [])) {
          const ch = row.video?.channelId;
          if (ch) channelCounts.set(ch, (channelCounts.get(ch) || 0) + 1);
        }
      }

      // Retorna o canal com mais vídeos (mais provável de ser o canal principal do anunciante)
      const sorted = Array.from(channelCounts.entries()).sort((a, b) => b[1] - a[1]);
      const channelId = sorted[0]?.[0] || null;

      return new Response(JSON.stringify({ channelId, allChannelIds: sorted.map(([id]) => id) }), {
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
