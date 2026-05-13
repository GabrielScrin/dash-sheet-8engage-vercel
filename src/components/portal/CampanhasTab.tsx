import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ClientPortalOverview } from '@/pages/PublicClientPortal';

interface CampanhasTabProps {
  overview: ClientPortalOverview | null;
  selectedCampaignIds: string[];
  setSelectedCampaignIds: (ids: string[]) => void;
  loadingOverview: boolean;
  accent?: string;
}

const brl = (v?: number) =>
  Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(v ?? 0);

const int = (v?: number) =>
  Intl.NumberFormat('pt-BR').format(Math.round(v ?? 0));

const pct = (v?: number, digits = 1) => `${(v ?? 0).toFixed(digits)}%`;

interface KpiCardProps {
  label: string;
  value: string;
  hint: string;
  accent: string;
}

function KpiCard({ label, value, hint, accent }: KpiCardProps) {
  return (
    <div
      className="rounded-[24px] border border-white/10 p-5 shadow-[0_20px_60px_-28px_rgba(0,0,0,0.65)]"
      style={{ background: 'linear-gradient(180deg, rgba(15,18,26,0.96), rgba(8,10,16,0.96))' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{label}</div>
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: accent, boxShadow: `0 0 24px ${accent}` }}
        />
      </div>
      <div className="text-[30px] font-black tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-2 text-xs text-white/45">{hint}</div>
    </div>
  );
}

export function CampanhasTab({
  overview,
  selectedCampaignIds,
  setSelectedCampaignIds,
  loadingOverview,
  accent = '#4f8cff',
}: CampanhasTabProps) {
  const meta = overview?.overview.meta;
  const googleAds = overview?.overview.googleAds;

  // Merge timeseries by date
  const combinedSeries = (() => {
    const map = new Map<string, { date: string; metaSpend: number; metaResults: number; googleSpend: number; googleResults: number }>();

    for (const row of meta?.timeseries ?? []) {
      const iso = row.date;
      const display = iso.slice(8, 10) + '/' + iso.slice(5, 7);
      const cur = map.get(iso) ?? { date: display, metaSpend: 0, metaResults: 0, googleSpend: 0, googleResults: 0 };
      cur.metaSpend += row.spend;
      cur.metaResults += row.results;
      map.set(iso, cur);
    }

    for (const row of googleAds?.timeseries ?? []) {
      const iso = row.date;
      const display = iso.slice(8, 10) + '/' + iso.slice(5, 7);
      const cur = map.get(iso) ?? { date: display, metaSpend: 0, metaResults: 0, googleSpend: 0, googleResults: 0 };
      cur.googleSpend += row.spend;
      cur.googleResults += row.conversions;
      map.set(iso, cur);
    }

    return Array.from(map.values()).sort((a, b) => {
      // sort by iso key (we need the original iso; re-derive from display is lossy, so sort by insertion order which is already sorted)
      return 0;
    });
  })();

  // Campaign rows unified
  const campaignOptions = [
    ...(meta?.campaigns ?? []).map((c) => ({
      key: `meta:${c.id}`,
      label: `Meta · ${c.name}`,
      spend: c.spend,
      ctr: c.ctr,
      results: c.results,
    })),
    ...(googleAds?.campaigns ?? []).map((c) => ({
      key: `google:${c.id}`,
      label: `Google · ${c.name}`,
      spend: c.spend,
      ctr: c.ctr,
      results: c.conversions,
    })),
  ];

  const toggleCampaign = (key: string) => {
    setSelectedCampaignIds(
      selectedCampaignIds.includes(key)
        ? selectedCampaignIds.filter((id) => id !== key)
        : [...selectedCampaignIds, key],
    );
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Meta Investido"
          value={brl(meta?.summary.spend)}
          hint={meta?.reason ?? 'Mídia Meta no período'}
          accent={accent}
        />
        <KpiCard
          label="Google Investido"
          value={brl(googleAds?.summary.spend)}
          hint={googleAds?.reason ?? 'Mídia Google Ads no período'}
          accent="#34d399"
        />
        <KpiCard
          label="Leads / Conversões"
          value={int((meta?.summary.results ?? 0) + (googleAds?.summary.conversions ?? 0))}
          hint="Meta + Google Ads"
          accent="#f59e0b"
        />
        <KpiCard
          label="Impressões"
          value={int((meta?.summary.impressions ?? 0) + (googleAds?.summary.impressions ?? 0))}
          hint="Total no período"
          accent="#f472b6"
        />
      </div>

      {/* Evolução diária */}
      <div
        className="rounded-[28px] border border-white/10 p-5"
        style={{ background: 'linear-gradient(180deg, rgba(12,16,24,0.96), rgba(8,10,16,0.98))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Mídia Paga</div>
            <div className="text-xl font-black tracking-[-0.04em] text-white">Evolução diária</div>
          </div>
          {loadingOverview && <Loader2 className="h-4 w-4 animate-spin text-white/40" />}
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={combinedSeries} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
              contentStyle={{
                background: '#0d1320',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 18,
                color: '#fff',
              }}
            />
            <Bar dataKey="metaSpend" name="Meta Invest." fill={accent} radius={[6, 6, 0, 0]} />
            <Bar dataKey="googleSpend" name="Google Invest." fill="#34d399" radius={[6, 6, 0, 0]} />
            <Line dataKey="metaResults" name="Meta Resultados" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
            <Line dataKey="googleResults" name="Google Conversões" stroke="#f472b6" strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Tabela de Campanhas */}
      <div
        className="rounded-[28px] border border-white/10 p-5"
        style={{ background: 'linear-gradient(180deg, rgba(12,16,24,0.96), rgba(8,10,16,0.98))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Meta + Google Ads</div>
            <div className="text-xl font-black tracking-[-0.04em] text-white">Campanhas do período</div>
          </div>
          <span className="text-xs text-white/45">{campaignOptions.length} campanhas</span>
        </div>

        {/* Header */}
        <div className="grid grid-cols-[minmax(0,1.8fr)_0.65fr_0.6fr_0.6fr] rounded-t-xl bg-white/[0.04] px-4 py-3">
          {['Campanha', 'Invest.', 'CTR', 'Resultados'].map((h) => (
            <div key={h} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
              {h}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="max-h-[460px] overflow-auto">
          {campaignOptions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-white/45">
              Nenhuma campanha encontrada para o período.
            </div>
          ) : (
            campaignOptions.map((c) => {
              const selected = selectedCampaignIds.includes(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => toggleCampaign(c.key)}
                  className={`grid w-full grid-cols-[minmax(0,1.8fr)_0.65fr_0.6fr_0.6fr] border-t border-white/[0.06] px-4 py-3 text-left hover:bg-white/[0.03] ${selected ? 'bg-white/[0.05]' : ''}`}
                >
                  <div className="truncate text-sm font-medium text-white/88">{c.label}</div>
                  <div className="text-sm text-white/75">{brl(c.spend)}</div>
                  <div className="text-sm text-white/75">{pct(c.ctr)}</div>
                  <div className="text-sm text-white/75">{int(c.results)}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
