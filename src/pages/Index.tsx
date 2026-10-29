import { QuickActions } from "@/components/dashboard/quick-actions";
import { AlertsSection } from "@/components/dashboard/alerts-section";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { HeroBalance } from "@/components/dashboard/hero-balance";
import { AccountProgress } from "@/components/dashboard/account-progress";

const Index = () => {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">Visão geral das suas operações financeiras</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HeroBalance />
        </div>
        <AccountProgress />
      </div>

      <CashflowChart />

      <QuickActions />

      <AlertsSection />
    </div>
  );
};

export default Index;
