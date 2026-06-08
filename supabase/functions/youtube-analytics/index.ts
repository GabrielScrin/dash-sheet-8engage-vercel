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

async function getChannelStats(accessToken: string) {
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 || res.status === 401) throw new Error('YOUTUBE_SCOPE_REQUIRED');
    throw new Error(`YouTube Data API error: ${body}`);
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
    if (res.status === 403 || res.status === 401) throw new Error('YOUTUBE_SCOPE_REQUIRED');
    throw new Error(`YouTube Analytics API error: ${body}`);
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

    if (googleToken) {
      accessToken = googleToken;
    } else {
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

        if (tokenError || !tokenData?.is_active) {
          return new Response(JSON.stringify({ error: "Invalid share token" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
          return new Response(JSON.stringify({ error: "Share token expired" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
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
        if (userError || !user) {
          return new Response(JSON.stringify({ error: "Invalid token" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        ownerUserId = user.id;
      }

      const { data: tokenRow, error: tokenError } = await supabase
        .from("service_tokens")
        .select("refresh_token")
        .eq("user_id", ownerUserId)
        .eq("provider", "google")
        .maybeSingle();

      if (tokenError || !tokenRow?.refresh_token) {
        return new Response(JSON.stringify({
          error: "Google account not connected",
          code: "GOOGLE_RECONNECT_REQUIRED",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessToken = await refreshAccessToken(tokenRow.refresh_token);
    }

    const [channelData, analytics28, topVideos] = await Promise.all([
      getChannelStats(accessToken),
      getAnalytics28Days(accessToken),
      getTopVideos(accessToken, 7),
    ]);

    const channel = channelData.items?.[0];
    const stats = channel?.statistics || {};
    const analyticsRow: number[] = analytics28.rows?.[0] || [0, 0, 0, 0];

    const result = {
      channel: {
        id: channel?.id,
        title: channel?.snippet?.title,
        thumbnailUrl: channel?.snippet?.thumbnails?.default?.url,
        subscribers: Number(stats.subscriberCount || 0),
        totalViews: Number(stats.viewCount || 0),
        videoCount: Number(stats.videoCount || 0),
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
    if (error.message?.includes('YOUTUBE_SCOPE_REQUIRED')) {
      // Retorna 200 para que o supabase-js coloque no `data`, não no `error`
      return new Response(JSON.stringify({ requiresYoutubeScope: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
