import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  Users,
  ShoppingCart,
  DollarSign,
  Heart,
  AlertTriangle,
  Package,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Retail Analytics Dashboard" },
      {
        name: "description",
        content:
          "KPIs, CLV, MRR, RFM segmentation and product churn for the UCI Online Retail dataset.",
      },
    ],
  }),
});

type Analytics = {
  kpis: {
    total_revenue: number;
    total_orders: number;
    total_customers: number;
    total_products: number;
    aov: number;
    avg_orders_per_customer: number;
    avg_clv: number;
    median_clv: number;
    churn_rate: number;
    snapshot_date: string;
    raw_rows: number;
    clean_rows: number;
  };
  monthly: Array<{
    month: string;
    revenue: number;
    orders: number;
    customers: number;
    new_customers: number;
    returning_customers: number;
  }>;
  segments: Array<{ segment: string; customers: number; revenue: number }>;
  top_products: Array<{
    code: string;
    description: string;
    revenue: number;
    quantity: number;
    orders: number;
  }>;
  declining_products: Array<{
    code: string;
    description: string;
    change_pct: number;
    prior_revenue: number;
  }>;
  growing_products: Array<{
    code: string;
    description: string;
    change_pct: number;
    prior_revenue: number;
  }>;
  countries: Array<{
    country: string;
    revenue: number;
    customers: number;
    orders: number;
  }>;
  clv_distribution: Array<{ bucket: string; count: number }>;
};

const SEGMENT_COLORS: Record<string, string> = {
  Champions: "oklch(0.72 0.17 155)",
  Loyal: "oklch(0.68 0.19 275)",
  Potential: "oklch(0.78 0.15 75)",
  "At Risk": "oklch(0.65 0.22 25)",
  Lost: "oklch(0.55 0.02 260)",
};

function fmtGBP(n: number, digits = 0) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: digits,
  }).format(n);
}
function fmtNum(n: number) {
  return new Intl.NumberFormat("en-GB").format(n);
}

function Dashboard() {
  const [data, setData] = useState<Analytics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/analytics.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err)
    return (
      <div className="min-h-screen flex items-center justify-center text-danger">
        Failed to load analytics: {err}
      </div>
    );
  if (!data)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading analytics…
      </div>
    );

  const k = data.kpis;
  const monthly = data.monthly.map((m) => ({
    ...m,
    label: m.month.slice(2),
  }));
  const lastMonth = monthly[monthly.length - 1];
  const prevMonth = monthly[monthly.length - 2];
  const mrrDelta =
    prevMonth ? ((lastMonth.revenue - prevMonth.revenue) / prevMonth.revenue) * 100 : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              UCI Online Retail · snapshot {k.snapshot_date}
            </div>
            <h1 className="text-3xl font-bold mt-1">Retail Analytics Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {fmtNum(k.clean_rows)} clean transactions from{" "}
              {fmtNum(k.raw_rows)} raw rows · {fmtNum(k.total_customers)} customers ·{" "}
              {fmtNum(k.total_products)} products
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground">
              Pandas · cleaned server-side
            </span>
            <span className="px-3 py-1.5 rounded-full bg-primary/15 text-primary">
              Live dashboard
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* KPI grid */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Kpi icon={<DollarSign size={16} />} label="Total Revenue" value={fmtGBP(k.total_revenue)} />
          <Kpi icon={<ShoppingCart size={16} />} label="Orders" value={fmtNum(k.total_orders)} />
          <Kpi icon={<Users size={16} />} label="Customers" value={fmtNum(k.total_customers)} />
          <Kpi icon={<TrendingUp size={16} />} label="Avg Order Value" value={fmtGBP(k.aov, 2)} />
          <Kpi icon={<Heart size={16} />} label="Avg CLV" value={fmtGBP(k.avg_clv)} sub={`median ${fmtGBP(k.median_clv)}`} />
          <Kpi
            icon={<AlertTriangle size={16} />}
            label="Churn (90d)"
            value={`${(k.churn_rate * 100).toFixed(1)}%`}
            tone="danger"
          />
        </section>

        {/* MRR */}
        <section className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Monthly Revenue"
              subtitle={
                prevMonth
                  ? `${fmtGBP(lastMonth.revenue)} last month · ${mrrDelta >= 0 ? "+" : ""}${mrrDelta.toFixed(1)}% MoM`
                  : ""
              }
            />
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={monthly}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.68 0.19 275)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="oklch(0.68 0.19 275)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 265)" />
                <XAxis dataKey="label" stroke="oklch(0.7 0.02 260)" fontSize={12} />
                <YAxis
                  stroke="oklch(0.7 0.02 260)"
                  fontSize={12}
                  tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => fmtGBP(v)}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="oklch(0.68 0.19 275)"
                  strokeWidth={2}
                  fill="url(#rev)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <CardHeader title="RFM Segments" subtitle="Champions to Lost" />
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.segments}
                  dataKey="customers"
                  nameKey="segment"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={2}
                >
                  {data.segments.map((s) => (
                    <Cell key={s.segment} fill={SEGMENT_COLORS[s.segment]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, n) => [fmtNum(v) + " customers", n]}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  wrapperStyle={{ fontSize: 12, color: "oklch(0.7 0.02 260)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </section>

        {/* New vs returning + CLV */}
        <section className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="New vs Returning Customers" subtitle="Monthly acquisition mix" />
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 265)" />
                <XAxis dataKey="label" stroke="oklch(0.7 0.02 260)" fontSize={12} />
                <YAxis stroke="oklch(0.7 0.02 260)" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="new_customers" stackId="a" fill="oklch(0.68 0.19 275)" name="New" />
                <Bar
                  dataKey="returning_customers"
                  stackId="a"
                  fill="oklch(0.78 0.15 75)"
                  name="Returning"
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <CardHeader
              title="CLV Distribution"
              subtitle={`Mean ${fmtGBP(k.avg_clv)} · Median ${fmtGBP(k.median_clv)}`}
            />
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.clv_distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 265)" />
                <XAxis dataKey="bucket" stroke="oklch(0.7 0.02 260)" fontSize={9} interval={2} />
                <YAxis stroke="oklch(0.7 0.02 260)" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="oklch(0.72 0.17 155)" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </section>

        {/* Orders / customer trends */}
        <section className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Monthly Orders" subtitle="Transaction volume" />
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 265)" />
                <XAxis dataKey="label" stroke="oklch(0.7 0.02 260)" fontSize={12} />
                <YAxis stroke="oklch(0.7 0.02 260)" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="orders"
                  stroke="oklch(0.75 0.14 210)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <CardHeader title="Top Countries by Revenue" subtitle="Top 10 markets" />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.countries} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.03 265)" />
                <XAxis
                  type="number"
                  stroke="oklch(0.7 0.02 260)"
                  fontSize={12}
                  tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  type="category"
                  dataKey="country"
                  stroke="oklch(0.7 0.02 260)"
                  fontSize={11}
                  width={80}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtGBP(v)} />
                <Bar dataKey="revenue" fill="oklch(0.68 0.19 275)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </section>

        {/* Product churn */}
        <section className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader
              title="Declining Products"
              subtitle="Biggest MoM drops (last 2 vs prior 2 months)"
              icon={<ArrowDownRight size={16} className="text-danger" />}
            />
            <ProductChangeTable rows={data.declining_products} negative />
          </Card>
          <Card>
            <CardHeader
              title="Growing Products"
              subtitle="Biggest MoM gains (last 2 vs prior 2 months)"
              icon={<ArrowUpRight size={16} className="text-success" />}
            />
            <ProductChangeTable rows={data.growing_products} />
          </Card>
        </section>

        {/* Top products */}
        <section>
          <Card>
            <CardHeader
              title="Top Products by Revenue"
              subtitle="Best sellers across the full period"
              icon={<Package size={16} className="text-primary" />}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Description</th>
                    <th className="py-2 pr-4 text-right">Revenue</th>
                    <th className="py-2 pr-4 text-right">Units</th>
                    <th className="py-2 text-right">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_products.map((p) => (
                    <tr key={p.code} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{p.code}</td>
                      <td className="py-2 pr-4">{p.description}</td>
                      <td className="py-2 pr-4 text-right font-medium">{fmtGBP(p.revenue)}</td>
                      <td className="py-2 pr-4 text-right">{fmtNum(p.quantity)}</td>
                      <td className="py-2 text-right">{fmtNum(p.orders)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <footer className="text-xs text-muted-foreground pt-4 pb-2">
          Analysis pipeline: Pandas cleaning (remove nulls, cancellations, negatives, duplicates) →
          KPI + RFM computation → JSON export → this dashboard. Full report and CSV also produced
          as downloadable artifacts.
        </footer>
      </main>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "oklch(0.22 0.025 265)",
  border: "1px solid oklch(0.3 0.03 265)",
  borderRadius: 8,
  fontSize: 12,
  color: "oklch(0.97 0.005 250)",
};

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span className={tone === "danger" ? "text-danger" : "text-primary"}>{icon}</span>
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold ${tone === "danger" ? "text-danger" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>{children}</div>
  );
}

function CardHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          {icon}
          {title}
        </h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function ProductChangeTable({
  rows,
  negative,
}: {
  rows: Array<{ description: string; change_pct: number; prior_revenue: number }>;
  negative?: boolean;
}) {
  if (!rows.length)
    return <div className="text-sm text-muted-foreground">Not enough data.</div>;
  return (
    <div className="space-y-2">
      {rows.map((p, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 text-sm border-b border-border/50 pb-2 last:border-0"
        >
          <div className="truncate flex-1">{p.description}</div>
          <div
            className={`text-xs font-mono ${negative ? "text-danger" : "text-success"}`}
          >
            {p.change_pct > 0 ? "+" : ""}
            {p.change_pct.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground w-20 text-right">
            {fmtGBP(p.prior_revenue)}
          </div>
        </div>
      ))}
    </div>
  );
}