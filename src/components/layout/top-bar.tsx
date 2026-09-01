import { useState } from "react"
import {
  Search,
  Bell,
  ChevronDown,
  Building2,
  AlertTriangle,
  Info,
  CheckCircle,
  Clock,
} from "lucide-react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"
import { useAccountBalance } from "@/hooks/use-payments"
import { useAlerts, type AlertType } from "@/hooks/use-alerts"

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function alertIcon(type: AlertType) {
  switch (type) {
    case "urgent":
      return <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
    case "warning":
      return <Clock className="h-4 w-4 text-warning mt-0.5" />
    case "success":
      return <CheckCircle className="h-4 w-4 text-success mt-0.5" />
    default:
      return <Info className="h-4 w-4 text-primary mt-0.5" />
  }
}

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return "agora"
  if (minutes < 60) return `${minutes} min atrás`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h atrás`
  return `${Math.floor(hours / 24)}d atrás`
}

export function TopBar() {
  const { user, signOut } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const { data: balanceCents } = useAccountBalance()
  const { data: alerts } = useAlerts()

  const unreadCount = alerts?.filter((a) => !a.read).length ?? 0
  const displayName = user?.full_name ?? user?.email ?? "Usuário"
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join("")

  return (
    <header className="h-16 bg-background border-b border-border flex items-center justify-between px-4 gap-4">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="text-foreground" />
        
        {/* Global Search */}
        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Buscar transações, clientes, boletos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Conta — hoje é sempre uma única conta por usuário (unique(user_id) no banco) */}
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 min-w-[200px]">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <div className="text-left">
            <div className="text-sm font-medium">Conta Principal</div>
            <div className="text-xs text-muted-foreground">
              {balanceCents === undefined ? "…" : formatCents(balanceCents)}
            </div>
          </div>
        </div>

        {/* Notifications — alertas reais do backend (GET /alerts) */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
                >
                  {unreadCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Notificações</h4>
              <div className="space-y-2">
                {(!alerts || alerts.length === 0) && (
                  <p className="text-sm text-muted-foreground py-2">Nenhum alerta no momento.</p>
                )}
                {alerts?.slice(0, 10).map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-lg border ${
                      alert.type === "urgent" ? "border-destructive/20 bg-destructive/5" : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2">
                        {alertIcon(alert.type)}
                        <div className="flex-1">
                          <p className="text-sm font-medium">{alert.title}</p>
                          <p className="text-xs text-muted-foreground">{alert.description}</p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">
                        {relativeTime(alert.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 p-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gradient-primary text-white font-medium">
                  {initials || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="text-left hidden sm:block">
                <div className="text-sm font-medium">{displayName}</div>
                <div className="text-xs text-muted-foreground">{user?.email}</div>
              </div>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Perfil</DropdownMenuItem>
            <DropdownMenuItem>Configurações</DropdownMenuItem>
            <DropdownMenuItem>Suporte</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => void signOut()}>
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}