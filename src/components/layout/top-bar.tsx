import { useState } from "react"
import { 
  Search, 
  Bell, 
  ChevronDown, 
  Building2,
  Zap,
  AlertTriangle,
  Check
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

const notifications = [
  {
    id: 1,
    type: "fraud",
    title: "Tentativa de fraude detectada",
    description: "PIX de R$ 15.000 bloqueado automaticamente",
    time: "2 min atrás",
    urgent: true,
  },
  {
    id: 2,
    type: "kyc",
    title: "KYC pendente",
    description: "Cliente João Silva aguarda verificação",
    time: "15 min atrás",
    urgent: false,
  },
  {
    id: 3,
    type: "payment",
    title: "Boletos vencendo hoje",
    description: "12 boletos vencem nas próximas 2 horas",
    time: "1 hora atrás",
    urgent: false,
  },
]

const accounts = [
  { id: "main", name: "Conta Principal", balance: "R$ 1.247.350,42" },
  { id: "savings", name: "Conta Poupança", balance: "R$ 89.562,18" },
  { id: "business", name: "Conta Empresarial", balance: "R$ 2.847.291,75" },
]

export function TopBar() {
  const { user, signOut } = useAuth()
  const [selectedAccount, setSelectedAccount] = useState(accounts[0])
  const [searchQuery, setSearchQuery] = useState("")

  const unreadCount = notifications.filter(n => n.urgent).length
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
        {/* PIX/API Status */}
        <div className="flex items-center gap-2 text-sm">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-success rounded-full"></div>
            <span className="text-muted-foreground">PIX</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-success rounded-full"></div>
            <span className="text-muted-foreground">API</span>
          </div>
        </div>

        {/* Account Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 min-w-[200px] justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <div className="text-left">
                  <div className="text-sm font-medium">{selectedAccount.name}</div>
                  <div className="text-xs text-muted-foreground">{selectedAccount.balance}</div>
                </div>
              </div>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>Contas</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {accounts.map((account) => (
              <DropdownMenuItem
                key={account.id}
                onClick={() => setSelectedAccount(account)}
                className="cursor-pointer"
              >
                <div className="flex items-center justify-between w-full">
                  <div>
                    <div className="font-medium">{account.name}</div>
                    <div className="text-xs text-muted-foreground">{account.balance}</div>
                  </div>
                  {selectedAccount.id === account.id && <Check className="h-4 w-4" />}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
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
                {notifications.map((notification) => (
                  <div 
                    key={notification.id} 
                    className={`p-3 rounded-lg border ${
                      notification.urgent ? 'border-destructive/20 bg-destructive/5' : 'border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2">
                        {notification.type === 'fraud' && <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />}
                        {notification.type === 'kyc' && <Zap className="h-4 w-4 text-warning mt-0.5" />}
                        {notification.type === 'payment' && <Bell className="h-4 w-4 text-primary mt-0.5" />}
                        <div className="flex-1">
                          <p className="text-sm font-medium">{notification.title}</p>
                          <p className="text-xs text-muted-foreground">{notification.description}</p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{notification.time}</span>
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