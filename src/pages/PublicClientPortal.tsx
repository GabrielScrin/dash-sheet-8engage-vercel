import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, AlertCircle, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CampanhasTab } from '@/components/portal/CampanhasTab';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MetaPlatformData {
  summary: { spend: number; results: number; impressions: number };
  timeseries: Array<{ date: string; spend: number; results: number }>;
  campaigns: Array<{ id: string; name: string; spend: number; ctr: number; results: number }>;
  reason?: string;
}

export interface GoogleAdsPlatformData {
  summary: { spend: number; conversions: number; impressions: number };
  timeseries: Array<{ date: string; spend: number; conversions: number }>;
  campaigns: Array<{ id: string; name: string; spend: number; ctr: number; conversions: number }>;
  reason?: string;
}

export interface ClientPortalOverview {
  overview: {
    meta: MetaPlatformData;
    googleAds: GoogleAdsPlatformData;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyMeta(reason?: string): MetaPlatformData {
  return { summary: { spend: 0, results: 0, impressions: 0 }, timeseries: [], campaigns: [], reason };
}

function emptyGoogle(reason?: string): GoogleAdsPlatformData {
  return { summary: { spend: 0, conversions: 0, impressions: 0 }, timeseries: [], campaigns: [], reason };
}

// ─── Loading / Error screens ──────────────────────────────────────────────────

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#080b12]">
      <Loader2 className="h-8 w-8 animate-spin text-white/40" />
    </div>
  );
}

function FullScreenError({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#080b12] p-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-white/70">{message || 'Acesso negado ou link inválido.'}</p>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const TABS = [{ id: 'campanhas', label: 'Campanhas' }];

export default function PublicClientPortal() {
  const { token } = useParams<{ token: string }>();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [adAccountId, setAdAccountId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Portal do Cliente');
  const [accent, setAccent] = useState('#4f8cff');
  const [validationStatus, setValidationStatus] = useState<'loading' | 'validated' | 'error'>('loading');
  const [validationError, setValidationError] = useState('');
  const [activeTab, setActiveTab] = useState('campanhas');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });

  // ── Validate share token ───────────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setValidationStatus('error');
      setValidationError('Token não fornecido.');
      return;
    }

    supabase.functions
      .invoke('validate-share-token', { body: { token } })
      .then(({ data, error }) => {
        if (error || !data?.valid) {
          setValidationStatus('error');
          setValidationError(data?.error || 'Token inválido ou expirado.');
          return;
        }
        setProjectId(data.projectId);
        setProjectName(data.tokenName || data.project?.name || 'Portal do Cliente');

        const cfg = data.project?.source_config as Record<string, unknown> | null;
        if (cfg?.ad_account_id) setAdAccountId(String(cfg.ad_account_id));
        if (cfg?.brand_color) setAccent(String(cfg.brand_color));

        setValidationStatus('validated');
      })
      .catch(() => {
        setValidationStatus('error');
        setValidationError('Falha ao validar o link.');
      });
  }, [token]);

  // ── Fetch Meta data ────────────────────────────────────────────────────────
  const metaQuery = useQuery({
    queryKey: ['portal-meta', adAccountId, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async (): Promise<MetaPlatformData> => {
      if (!adAccountId) return emptyMeta('Conta Meta não configurada neste projeto.');
      const startDate = format(dateRange.from!, 'yyyy-MM-dd');
      const endDate = format(dateRange.to!, 'yyyy-MM-dd');

      try {
        const sharedHeaders = { 'x-share-token': token! };

        const [{ data: tsData, error: tsErr }, { data: campData, error: campErr }] = await Promise.all([
          supabase.functions.invoke(
            `meta-api?action=insights&accountId=${adAccountId}&startDate=${startDate}&endDate=${endDate}&level=account&timeIncrement=1`,
            { headers: sharedHeaders },
          ),
          supabase.functions.invoke(
            `meta-api?action=insights&accountId=${adAccountId}&startDate=${startDate}&endDate=${endDate}&level=campaign&timeIncrement=all`,
            { headers: sharedHeaders },
          ),
        ]);

        if (tsErr) throw new Error(tsErr.message);
        if (campErr) throw new Error(campErr.message);

        const tsRows: any[] = tsData?.data ?? [];
        const campRows: any[] = campData?.data ?? [];

        const timeseries = tsRows.map((r) => ({
          date: String(r.date || ''),
          spend: Number(r.spend || 0),
          results: Number(r.purchases || 0) > 0 ? Number(r.purchases) : Number(r.leads || 0),
        }));

        const summary = tsRows.reduce(
          (acc, r) => ({
            spend: acc.spend + Number(r.spend || 0),
            results:
              acc.results + (Number(r.purchases || 0) > 0 ? Number(r.purchases || 0) : Number(r.leads || 0)),
            impressions: acc.impressions + Number(r.impressions || 0),
          }),
          { spend: 0, results: 0, impressions: 0 },
        );

        const campaigns = campRows
          .filter((c) => c.campaign_id)
          .map((c) => ({
            id: String(c.campaign_id),
            name: String(c.campaign_name || c.campaign_id),
            spend: Number(c.spend || 0),
            ctr: Number(c.ctr || 0),
            results: Number(c.purchases || 0) > 0 ? Number(c.purchases || 0) : Number(c.leads || 0),
          }));

        return { summary, timeseries, campaigns };
      } catch (e: any) {
        return emptyMeta(e.message || 'Erro ao carregar dados da Meta.');
      }
    },
    enabled: validationStatus === 'validated' && !!adAccountId && !!dateRange.from && !!dateRange.to,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // ── Fetch Google Ads data ──────────────────────────────────────────────────
  const googleQuery = useQuery({
    queryKey: ['portal-google', projectId, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async (): Promise<GoogleAdsPlatformData> => {
      if (!projectId) return emptyGoogle('Projeto não identificado.');
      const startDate = format(dateRange.from!, 'yyyy-MM-dd');
      const endDate = format(dateRange.to!, 'yyyy-MM-dd');

      try {
        const { data, error } = await supabase.functions.invoke('google-ads-api?action=portal-overview', {
          body: { projectId, startDate, endDate },
          headers: { 'x-share-token': token! },
        });

        if (error) throw new Error(error.message);

        return {
          summary: data?.totals ?? { spend: 0, conversions: 0, impressions: 0 },
          timeseries: (data?.timeseries ?? []).map((r: any) => ({
            date: String(r.date || ''),
            spend: Number(r.spend || 0),
            conversions: Number(r.conversions || 0),
          })),
          campaigns: (data?.campaigns ?? []).map((c: any) => ({
            id: String(c.id || ''),
            name: String(c.name || ''),
            spend: Number(c.spend || 0),
            ctr: Number(c.ctr || 0),
            conversions: Number(c.conversions || 0),
          })),
        };
      } catch (e: any) {
        return emptyGoogle(e.message || 'Google Ads não conectado neste projeto.');
      }
    },
    enabled: validationStatus === 'validated' && !!projectId && !!dateRange.from && !!dateRange.to,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // ── Combine data ───────────────────────────────────────────────────────────
  const overview: ClientPortalOverview | null = useMemo(() => {
    if (!metaQuery.data && !googleQuery.data) return null;
    return {
      overview: {
        meta: metaQuery.data ?? emptyMeta(),
        googleAds: googleQuery.data ?? emptyGoogle(),
      },
    };
  }, [metaQuery.data, googleQuery.data]);

  const loadingOverview = metaQuery.isLoading || googleQuery.isLoading;

  // ── Date range label ───────────────────────────────────────────────────────
  const dateLabel =
    dateRange.from && dateRange.to
      ? `${format(dateRange.from, "d MMM", { locale: ptBR })} – ${format(dateRange.to, "d MMM yyyy", { locale: ptBR })}`
      : 'Selecionar período';

  // ── Render ─────────────────────────────────────────────────────────────────
  if (validationStatus === 'loading') return <FullScreenLoader />;
  if (validationStatus === 'error') return <FullScreenError message={validationError} />;

  return (
    <div className="min-h-screen bg-[#080b12] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#080b12]/90 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-4">
          <h1 className="text-base font-bold tracking-tight truncate">{projectName}</h1>
          <div className="flex items-center gap-2">
            {/* Date picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08] hover:text-white"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-xs">{dateLabel}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto p-0 border-white/10 bg-[#0d1320]"
                align="end"
              >
                <CalendarPicker
                  mode="range"
                  selected={dateRange}
                  onSelect={(range) => {
                    if (range?.from) setDateRange({ from: range.from, to: range.to ?? range.from });
                  }}
                  locale={ptBR}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Tabs nav */}
      <div className="border-b border-white/[0.07] bg-[#080b12]">
        <div className="container flex gap-1 py-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white/[0.08] text-white'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="container py-6">
        {activeTab === 'campanhas' && (
          <CampanhasTab
            overview={overview}
            selectedCampaignIds={selectedCampaignIds}
            setSelectedCampaignIds={setSelectedCampaignIds}
            loadingOverview={loadingOverview}
            accent={accent}
          />
        )}
      </main>
    </div>
  );
}
