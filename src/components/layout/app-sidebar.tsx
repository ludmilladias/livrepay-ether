import { useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import {
  Home,
  Receipt,
  CreditCard,
  TrendingUp,
  Shield,
  Wallet,
  FileText,
  Link,
  FileBarChart,
  Zap,
  PiggyBank,
  Building,
  ChevronDown
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar"
import { Logo } from "@/components/ui/logo"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

const mainItems = [
  { title: "Dashboard", url: "/", icon: Home },
]

const moduleItems = [
  {
    title: "Cobrança",
    icon: Receipt,
    items: [
      { title: "Links de Pagamento", url: "/cobranca/links" },
      { title: "Boletos", url: "/cobranca/boletos" },
      { title: "PIX Cobrança", url: "/cobranca/pix" },
      { title: "Assinaturas", url: "/cobranca/assinaturas" },
    ]
  },
  {
    title: "Recebíveis",
    icon: TrendingUp,
    items: [
      { title: "Agenda", url: "/recebiveis/agenda" },
      { title: "Simulador", url: "/recebiveis/simulador" },
      { title: "Adiantamento", url: "/recebiveis/adiantamento" },
      { title: "Contratos", url: "/recebiveis/contratos" },
    ]
  },
  {
    title: "Pagamentos",
    icon: CreditCard,
    items: [
      { title: "Transferências", url: "/pagamentos/transferencias" },
      { title: "Contas e Tributos", url: "/pagamentos/contas" },
      { title: "Folha/Lotes", url: "/pagamentos/folha" },
    ]
  },
  {
    title: "Seguros",
    icon: Shield,
    items: [
      { title: "Catálogo", url: "/seguros/catalogo" },
      { title: "Cotações", url: "/seguros/cotacoes" },
      { title: "Apólices", url: "/seguros/apolices" },
      { title: "Sinistros", url: "/seguros/sinistros" },
    ]
  },
  {
    title: "Cartões & Wallet",
    icon: Wallet,
    items: [
      { title: "Cartões Virtuais", url: "/cartoes/virtuais" },
      { title: "Limites", url: "/cartoes/limites" },
      { title: "Extratos", url: "/cartoes/extratos" },
    ]
  },
  {
    title: "Relatórios",
    icon: FileText,
    items: [
      { title: "Extratos", url: "/relatorios/extratos" },
      { title: "Conciliação", url: "/relatorios/conciliacao" },
      { title: "Financeiro", url: "/relatorios/financeiro" },
    ]
  },
]

const quickActions = [
  { title: "Criar Link", icon: Link },
  { title: "Emitir Boleto", icon: FileBarChart },
  { title: "PIX Cobrança", icon: Zap },
  { title: "Simular Adiantamento", icon: PiggyBank },
]

export function AppSidebar() {
  const { state } = useSidebar()
  const location = useLocation()
  const currentPath = location.pathname
  const collapsed = state === "collapsed"
  
  const [openGroups, setOpenGroups] = useState<string[]>([])

  const isActive = (path: string) => currentPath === path
  const isGroupActive = (items: readonly { url: string }[]) =>
    items.some(item => isActive(item.url))
  
  const toggleGroup = (title: string) => {
    setOpenGroups(prev => 
      prev.includes(title) 
        ? prev.filter(g => g !== title)
        : [...prev, title]
    )
  }

  const getNavCls = (active: boolean) =>
    active 
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium border-r-2 border-secondary" 
      : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"

  return (
    <Sidebar className={collapsed ? "w-16" : "w-64"} collapsible="icon">
      <SidebarHeader className="bg-white border-b border-sidebar-border p-6">
        <Logo size={collapsed ? "md" : "lg"} className="text-primary" />
      </SidebarHeader>

      <SidebarContent className="p-4 space-y-4">
        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarMenu className="space-y-1">
            {mainItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild className="h-10">
                  <NavLink to={item.url} className={getNavCls(isActive(item.url))}>
                    <item.icon className="h-5 w-5" />
                    {!collapsed && <span className="ml-3">{item.title}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* Modules */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/60 px-3 py-3 text-xs font-medium uppercase tracking-wide">
            {!collapsed && "Módulos"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {moduleItems.map((module) => {
                const isOpen = openGroups.includes(module.title) || isGroupActive(module.items)
                return (
                  <SidebarMenuItem key={module.title}>
                    <Collapsible open={isOpen} onOpenChange={() => toggleGroup(module.title)}>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton 
                          className={`w-full justify-between h-10 ${getNavCls(isGroupActive(module.items))}`}
                        >
                          <div className="flex items-center gap-3">
                            <module.icon className="h-5 w-5" />
                            {!collapsed && <span>{module.title}</span>}
                          </div>
                          {!collapsed && <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      {!collapsed && (
                        <CollapsibleContent className="pl-8 mt-1">
                          <div className="space-y-1">
                            {module.items.map((item) => (
                              <SidebarMenuItem key={item.title}>
                                <SidebarMenuButton asChild size="sm" className="h-9">
                                  <NavLink to={item.url} className={getNavCls(isActive(item.url))}>
                                    <span>{item.title}</span>
                                  </NavLink>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            ))}
                          </div>
                        </CollapsibleContent>
                      )}
                    </Collapsible>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Quick Actions */}
        {!collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/60 px-3 py-3 text-xs font-medium uppercase tracking-wide">
              Ações Rápidas
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {quickActions.map((action) => (
                  <SidebarMenuItem key={action.title}>
                    <SidebarMenuButton className="hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground h-9">
                      <action.icon className="h-4 w-4" />
                      <span className="ml-3">{action.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  )
}