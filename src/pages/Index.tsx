import { KPICards } from "@/components/dashboard/kpi-cards";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { AlertsSection } from "@/components/dashboard/alerts-section";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";

const Index = () => {
  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Visão geral das suas operações financeiras
        </p>
      </div>

      {/* KPIs */}
      <div className="mb-8">
        <KPICards />
      </div>

      {/* Fluxo de caixa */}
      <div className="mb-8">
        <CashflowChart />
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <QuickActions />
      </div>

      {/* Alerts and Next Actions */}
      <AlertsSection />
    </div>
  );
};

export default Index;
