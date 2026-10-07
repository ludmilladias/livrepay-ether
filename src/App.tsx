import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { RequireRole } from "@/components/auth/require-role";
import { OnboardingGate, OnboardingBanner } from "@/components/auth/onboarding-gate";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";

// Cobrança
import Links from "./pages/cobranca/Links";
import Boletos from "./pages/cobranca/Boletos";
import Pix from "./pages/cobranca/Pix";
import Assinaturas from "./pages/cobranca/Assinaturas";

// Recebíveis
import Agenda from "./pages/recebiveis/Agenda";
import Simulador from "./pages/recebiveis/Simulador";
import Adiantamento from "./pages/recebiveis/Adiantamento";
import Contratos from "./pages/recebiveis/Contratos";

// Pagamentos
import Transferencias from "./pages/pagamentos/Transferencias";
import Contas from "./pages/pagamentos/Contas";
import Folha from "./pages/pagamentos/Folha";

// Seguros e Cartões & Wallet: FORA DA NAVEGAÇÃO por decisão da dona do produto
// (2026-10). As telas em src/pages/seguros/* e src/pages/cartoes/* foram
// preservadas (servem para demonstração comercial), mas não têm backend: são
// arrays fixos e não persistidos. Para voltarem, é preciso antes:
//   - Cartões: definir o emissor de cartão (parceiro/BIN) e criar rota + tabelas;
//   - Seguros: definir o modelo de cotação de seguro (seguradora/precificação).
// Aí: reativar os imports e as rotas comentadas abaixo, o grupo no
// app-sidebar.tsx e a ação "Cotar Seguro" em dashboard/quick-actions.tsx.
//
// import Catalogo from "./pages/seguros/Catalogo";
// import Cotacoes from "./pages/seguros/Cotacoes";
// import Apolices from "./pages/seguros/Apolices";
// import Sinistros from "./pages/seguros/Sinistros";
// import Virtuais from "./pages/cartoes/Virtuais";
// import Limites from "./pages/cartoes/Limites";
// import ExtratosCartoes from "./pages/cartoes/Extratos";

// Relatórios
import ExtratosRelatorios from "./pages/relatorios/Extratos";
import Conciliacao from "./pages/relatorios/Conciliacao";
import Financeiro from "./pages/relatorios/Financeiro";

// Administração (admin/compliance)
import AdminOverview from "./pages/admin/Overview";
import VerificacaoRecebiveis from "./pages/admin/VerificacaoRecebiveis";
import EventosProvedor from "./pages/admin/EventosProvedor";
import Auditoria from "./pages/admin/Auditoria";
import Usuarios from "./pages/admin/Usuarios";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute>
                  <Onboarding />
                </ProtectedRoute>
              }
            />
            <Route
              path="*"
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <AppShell />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

const AppShell = () => (
  <SidebarProvider>
          <div className="min-h-screen flex w-full bg-background">
            <AppSidebar />
            <div className="flex-1 flex flex-col">
              <TopBar />
              <main className="flex-1 p-8 overflow-auto ml-4">
                <OnboardingBanner />
                <Routes>
                  <Route path="/" element={<Index />} />
                  
                  {/* Cobrança Routes */}
                  <Route path="/cobranca/links" element={<Links />} />
                  <Route path="/cobranca/boletos" element={<Boletos />} />
                  <Route path="/cobranca/pix" element={<Pix />} />
                  <Route path="/cobranca/assinaturas" element={<Assinaturas />} />
                  
                  {/* Recebíveis Routes */}
                  <Route path="/recebiveis/agenda" element={<Agenda />} />
                  <Route path="/recebiveis/simulador" element={<Simulador />} />
                  <Route path="/recebiveis/adiantamento" element={<Adiantamento />} />
                  <Route path="/recebiveis/contratos" element={<Contratos />} />
                  
                  {/* Pagamentos Routes */}
                  <Route path="/pagamentos/transferencias" element={<Transferencias />} />
                  <Route path="/pagamentos/contas" element={<Contas />} />
                  <Route path="/pagamentos/folha" element={<Folha />} />
                  
                  {/* Seguros e Cartões & Wallet: rotas removidas (ver comentário nos imports acima).
                      Quem acessar /seguros/* ou /cartoes/* cai no NotFound. Para reativar:
                      <Route path="/seguros/catalogo" element={<Catalogo />} /> (+ cotacoes, apolices, sinistros)
                      <Route path="/cartoes/virtuais" element={<Virtuais />} /> (+ limites, extratos) */}
                  
                  {/* Relatórios Routes */}
                  <Route path="/relatorios/extratos" element={<ExtratosRelatorios />} />
                  <Route path="/relatorios/conciliacao" element={<Conciliacao />} />
                  <Route path="/relatorios/financeiro" element={<Financeiro />} />

                  {/* Administração — role admin/compliance no banco decide de verdade,
                      isto é só roteamento (ver RequireRole). */}
                  <Route
                    path="/admin"
                    element={
                      <RequireRole roles={["admin", "compliance"]}>
                        <AdminOverview />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/recebiveis"
                    element={
                      <RequireRole roles={["admin", "compliance"]}>
                        <VerificacaoRecebiveis />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/eventos-provedor"
                    element={
                      <RequireRole roles={["admin", "compliance"]}>
                        <EventosProvedor />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/auditoria"
                    element={
                      <RequireRole roles={["admin", "compliance"]}>
                        <Auditoria />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/admin/usuarios"
                    element={
                      <RequireRole roles={["admin"]}>
                        <Usuarios />
                      </RequireRole>
                    }
                  />

                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>
            </div>
          </div>
  </SidebarProvider>
);

export default App;
