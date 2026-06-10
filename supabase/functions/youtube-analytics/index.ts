import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-google-token, x-share-token',
};

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth credentials not configured");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function classifyGoogleError(status: number, body: string): Error {
  if (status === 401) return new Error('YOUTUBE_SCOPE_REQUIRED');
  if (status === 403) {
    if (body.includes('accessNotConfigured') || body.includes('has not been used in project') || body.includes('disabled')) {
      return new Error('YOUTUBE_API_NOT_ENABLED');
    }
    return new Error('YOUTUBE_SCOPE_REQUIRED');
  }
  return new Error(`API error ${status}: ${body}`);
}

async function getChannelStats(accessToken: string) {
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error('getChannelStats error', res.status, body);
    throw classifyGoogleError(res.status, body);
  }
  return res.json();
}

async function getAnalytics28Days(accessToken: string) {
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDate = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const params = new URLSearchParams({
    ids: 'channel==mine',
    startDate,
    endDate,
    metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost',
  });

  const res = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error('getAnalytics28Days error', res.status, body);
    throw classifyGoogleError(res.status, body);
  }
  return res.json();
}

async function getTopVideos(accessToken: string, days = 7) {
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDate = new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const params = new URLSearchParams({
    ids: 'channel==mine',
    startDate,
    endDate,
    metrics: 'views',
    dimensions: 'video',
    sort: '-views',
    maxResults: '10',
  });

  const res = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 || res.status === 401) throw new Error('YOUTUBE_SCOPE_REQUIRED');
    throw new Error(`YouTube Analytics API error: ${body}`);
  }
  const data = await res.json();
  const rows: any[][] = data.rows || [];
  if (rows.length === 0) return { videos: [], startDate, endDate };

  const videoIds = rows.map((r) => r[0]).join(',');
  const detailsRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoIds}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const detailsData = detailsRes.ok ? await detailsRes.json() : { items: [] };
  const videoMap = new Map<string, any>(
    (detailsData.items || []).map((v: any) => [v.id, v.snippet])
  );

  const videos = rows.map((r) => {
    const videoId = r[0];
    const views = r[1];
    const snippet = videoMap.get(videoId);
    return {
      videoId,
      views,
      title: snippet?.title || videoId,
      thumbnailUrl: snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    };
  });

  return { videos, startDate, endDate };
}

async function resolveAccessToken(
  req: Request,
  authHeader: string,
  googleToken: string | null,
  shareToken: string | null,
): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let ownerUserId: string | null = null;

  if (shareToken) {
    const { data: tokenData, error: tokenError } = await supabase
      .from("share_tokens")
      .select("project_id, is_active, expires_at")
      .eq("token", shareToken)
      .single();

    if (tokenError || !tokenData?.is_active) throw new Error("INVALID_SHARE_TOKEN");
    if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) throw new Error("SHARE_TOKEN_EXPIRED");

    const { data: project } = await supabase
      .from("projects")
      .select("user_id")
      .eq("id", tokenData.project_id)
      .single();
    if (!project) throw new Error("Project owner not found");
    ownerUserId = project.user_id;
  } else {
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("INVALID_TOKEN");
    ownerUserId = user.id;
  }

  const { data: tokenRow } = await supabase
    .from("service_tokens")
    .select("refresh_token")
    .eq("user_id", ownerUserId)
    .eq("provider", "google")
    .maybeSingle();

  if (!tokenRow?.refresh_token) throw new Error("GOOGLE_RECONNECT_REQUIRED");
  return refreshAccessToken(tokenRow.refresh_token);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const googleToken = req.headers.get("x-google-token");
    const shareToken = req.headers.get("x-share-token");
    let accessToken: string;

    accessToken = googleToken ?? await resolveAccessToken(req, authHeader, googleToken, shareToken);

    let channelData: any, analytics28: any, topVideos: any;
    try {
      [channelData, analytics28, topVideos] = await Promise.all([
        getChannelStats(accessToken),
        getAnalytics28Days(accessToken),
        getTopVideos(accessToken, 7),
      ]);
    } catch (e: any) {
      if (e.message?.includes("YOUTUBE_SCOPE_REQUIRED") && googleToken) {
        // Token da sessão não tem escopo YouTube — tenta via refresh token do banco
        accessToken = await resolveAccessToken(req, authHeader, googleToken, shareToken);
        [channelData, analytics28, topVideos] = await Promise.all([
          getChannelStats(accessToken),
          getAnalytics28Days(accessToken),
          getTopVideos(accessToken, 7),
        ]);
      } else {
        throw e;
      }
    }

    const channel = channelData.items?.[0];
    const stats = channel?.statistics || {};

    // Log para diagnóstico — visível nos logs da Edge Function no Supabase
    console.log('=== YouTube Debug ===');
    console.log('channelItems count:', channelData.items?.length ?? 0);
    console.log('channel id:', channel?.id);
    console.log('channel title:', channel?.snippet?.title);
    console.log('statistics raw:', JSON.stringify(stats));
    console.log('hiddenSubscriberCount:', stats.hiddenSubscriberCount);
    console.log('analytics28 raw:', JSON.stringify(analytics28));
    console.log('analytics28 columnHeaders:', JSON.stringify(analytics28.columnHeaders));
    console.log('analytics28 rows:', JSON.stringify(analytics28.rows));

    const analyticsRow: number[] = analytics28.rows?.[0] || [0, 0, 0, 0];

    const result = {
      channel: {
        id: channel?.id,
        title: channel?.snippet?.title,
        thumbnailUrl: channel?.snippet?.thumbnails?.default?.url,
        // subscriberCount é string na API; undefined se hiddenSubscriberCount=true
        subscribers: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0),
        totalViews: Number(stats.viewCount ?? 0),
        videoCount: Number(stats.videoCount ?? 0),
        hiddenSubscriberCount: Boolean(stats.hiddenSubscriberCount),
      },
      period28Days: {
        views: analyticsRow[0] || 0,
        watchTimeMinutes: analyticsRow[1] || 0,
        watchTimeHours: Math.round((analyticsRow[1] || 0) / 60),
        subscribersGained: analyticsRow[2] || 0,
        subscribersLost: analyticsRow[3] || 0,
        netSubscribers: (analyticsRow[2] || 0) - (analyticsRow[3] || 0),
      },
      topVideos,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const msg: string = error.message || '';
    if (msg.includes('YOUTUBE_API_NOT_ENABLED')) {
      return new Response(JSON.stringify({ youtubeApiNotEnabled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (msg.includes('YOUTUBE_SCOPE_REQUIRED') || msg.includes('GOOGLE_RECONNECT_REQUIRED')) {
      // Retorna 200 para que o supabase-js coloque no `data`, não no `error`
      return new Response(JSON.stringify({ requiresYoutubeScope: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (msg === 'INVALID_SHARE_TOKEN') {
      return new Response(JSON.stringify({ error: "Invalid share token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (msg === 'SHARE_TOKEN_EXPIRED') {
      return new Response(JSON.stringify({ error: "Share token expired" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (msg === 'INVALID_TOKEN') {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
