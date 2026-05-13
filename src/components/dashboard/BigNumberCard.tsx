import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface BigNumberCardProps {
  label: string;
  value: number;
  previousValue?: number;
  format: 'number' | 'currency' | 'percentage' | 'decimal';
  delay?: number;
  subtitle?: string;
  budgetProgress?: number;   // 0–1+ ratio (spend / prorated budget)
  budgetSpend?: number;      // actual spend value for tooltip
  budgetTarget?: number;     // prorated budget value for tooltip
}

export function BigNumberCard({
  label,
  value,
  previousValue,
  format,
  delay = 0,
  subtitle,
  budgetProgress,
  budgetSpend,
  budgetTarget,
}: BigNumberCardProps) {
  const change = previousValue ? ((value - previousValue) / previousValue) * 100 : 0;
  const isPositive = change > 0;
  const isNegative = change < 0;

  const formatValue = (val: number): string => {
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
      case 'percentage':
        return `${val.toFixed(2)}%`;
      case 'decimal':
        return val.toFixed(2);
      default:
        return new Intl.NumberFormat('pt-BR').format(val);
    }
  };

  const getPrefix = (): string => {
    if (format === 'currency') return 'R$ ';
    return '';
  };

  const getSuffix = (): string => {
    if (format === 'percentage') return '%';
    return '';
  };

  const getDecimals = (): number => {
    if (format === 'percentage') return 2;
    if (format === 'decimal') return 1;
    if (format === 'currency') return 2;
    return 0;
  };

  const hasBudget = budgetProgress !== undefined;
  const budgetPct = hasBudget ? Math.min((budgetProgress ?? 0) * 100, 100) : 0;
  const budgetRaw = hasBudget ? (budgetProgress ?? 0) * 100 : 0;
  const withinBudget = (budgetProgress ?? 0) <= 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Card className="dashboard-card-hover cursor-default">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground truncate">{label}</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight" aria-live="polite">
                    <CountUp
                      start={0}
                      end={value}
                      duration={1.2}
                      delay={delay}
                      separator="."
                      decimal=","
                      prefix={getPrefix()}
                      suffix={getSuffix()}
                      decimals={getDecimals()}
                      useEasing
                    />
                  </span>
                </div>

                {subtitle && (
                  <p className="mt-1 text-xs text-muted-foreground leading-snug">{subtitle}</p>
                )}

                {previousValue !== undefined && !hasBudget && (
                  <div className="mt-2 flex items-center gap-1">
                    <span
                      className={`inline-flex items-center gap-0.5 text-sm font-medium ${
                        isPositive ? 'text-kpi-positive' : isNegative ? 'text-kpi-negative' : 'text-kpi-neutral'
                      }`}
                    >
                      {isPositive ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : isNegative ? (
                        <ArrowDown className="h-3.5 w-3.5" />
                      ) : (
                        <Minus className="h-3.5 w-3.5" />
                      )}
                      {Math.abs(change).toFixed(1)}%
                    </span>
                    <span className="text-xs text-muted-foreground">vs período anterior</span>
                  </div>
                )}

                {hasBudget && (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{budgetRaw.toFixed(1)}%</span>
                      <span className={withinBudget ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                        {withinBudget ? 'dentro da meta' : 'acima da meta'}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-700 ${withinBudget ? 'bg-green-500' : 'bg-red-500'}`}
                        style={{ width: `${budgetPct}%` }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent>
            <p>Valor atual: {formatValue(value)}</p>
            {hasBudget && budgetSpend !== undefined && (
              <p className="text-xs text-muted-foreground">
                Gasto: {formatValue(budgetSpend)} / Meta: {formatValue(budgetTarget ?? value)}
              </p>
            )}
            {previousValue !== undefined && !hasBudget && (
              <p className="text-xs text-muted-foreground">Período anterior: {formatValue(previousValue)}</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </motion.div>
  );
}
