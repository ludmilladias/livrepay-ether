import {
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
import { hasSupportChannel, SUPPORT_CONTACT } from "@/lib/support-contact"

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

/** Link do canal de suporte, só quando a dona do produto definiu um (lib/support-contact). */
function supportHref(): string | null {
  const { url, email, phone } = SUPPORT_CONTACT
  if (url) return url
  if (email) return `mailto:${email}`
  if (phone) return `tel:${phone.replace(/[^\d+]/g, "")}`
  return null
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
  const { data: balanceCents } = useAccountBalance()
  const { data: alerts } = useAlerts()

  const supportLink = hasSupportChannel() ? supportHref() : null
  const unreadCount = alerts?.filter((a) => !a.read).length ?? 0
  const displayName = user?.full_name ?? user?.email ?? "Usuário"
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join("")

  return (
    <header className="h-16 bg-background border-b border-border flex items-center justify-between px-2 sm:px-4 gap-2 sm:gap-4">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="text-foreground" />
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {/* Conta — hoje é sempre uma única conta por usuário (unique(user_id) no banco) */}
        <div className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-2 sm:px-3 sm:min-w-[200px]">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 text-left">
            <div className="hidden sm:block text-sm font-medium">Conta Principal</div>
            <div className="text-xs sm:text-xs text-muted-foreground truncate">
              <span className="sr-only">Saldo da conta principal: </span>
              {balanceCents === undefined ? "…" : formatCents(balanceCents)}
            </div>
          </div>
        </div>

        {/* Notifications — alertas reais do backend (GET /alerts) */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="relative shrink-0"
              aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {unreadCount > 0 && (
                <Badge
                  aria-hidden="true"
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
                >
                  {unreadCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(20rem,calc(100vw-1rem))]" align="end">
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
                          <p className="text-sm font-medium">
                            {alert.type === "urgent" && <span className="sr-only">Urgente: </span>}
                            {!alert.read && <span className="sr-only">Não lida: </span>}
                            {alert.title}
                          </p>
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
            <Button variant="ghost" className="gap-2 p-2" aria-label={`Menu da conta de ${displayName}`}>
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
            {/* Perfil e Configurações ainda não existem como telas: não aparecem. */}
            {supportLink && (
              <>
                <DropdownMenuItem asChild>
                  <a href={supportLink} target={supportLink.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
                    Suporte
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem className="text-destructive" onClick={() => void signOut()}>
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}