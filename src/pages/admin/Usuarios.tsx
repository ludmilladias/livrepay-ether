import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { X } from "lucide-react"
import { toast } from "sonner"
import { useState } from "react"
import { useAdminUsers, useAssignRole, useRemoveRole, type AdminUser } from "@/hooks/use-admin"

const ALL_ROLES = ["admin", "compliance", "support", "viewer"] as const

const roleClass: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  compliance: "bg-blue-100 text-blue-800",
  support: "bg-teal-100 text-teal-800",
  viewer: "bg-gray-100 text-gray-800",
}

const Usuarios = () => {
  const { data, isLoading, isError } = useAdminUsers()
  const assignRole = useAssignRole()
  const removeRole = useRemoveRole()
  const [selecting, setSelecting] = useState<Record<string, string>>({})

  const rows = data ?? []

  async function handleAssign(user: AdminUser) {
    const role = selecting[user.id]
    if (!role) return
    if (user.roles.includes(role)) {
      toast.info("Usuário já tem essa role.")
      return
    }
    try {
      await assignRole.mutateAsync({ userId: user.id, role })
      toast.success(`Role "${role}" atribuída a ${user.full_name ?? user.email}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atribuir a role.")
    }
  }

  async function handleRemove(user: AdminUser, role: string) {
    try {
      await removeRole.mutateAsync({ userId: user.id, role })
      toast.success(`Role "${role}" removida de ${user.full_name ?? user.email}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível remover a role.")
    }
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Usuários & Papéis</h1>
        <p className="text-muted-foreground mt-2">
          Só quem tem role <code>admin</code> pode atribuir ou remover papéis — ninguém se
          autopromove.
        </p>
      </div>

      {isError && (
        <p className="text-sm text-destructive">Não foi possível carregar os usuários.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{rows.length} usuário(s)</CardTitle>
          <CardDescription>
            Todo novo cadastro começa com <code>viewer</code> — menor privilégio por padrão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead className="text-right">Atribuir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.full_name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.length === 0 && (
                          <span className="text-xs text-muted-foreground">nenhuma</span>
                        )}
                        {user.roles.map((role) => (
                          <Badge
                            key={role}
                            variant="secondary"
                            className={`${roleClass[role] ?? ""} gap-1 pr-1`}
                          >
                            {role}
                            <button
                              type="button"
                              className="hover:opacity-70"
                              onClick={() => void handleRemove(user, role)}
                              aria-label={`Remover role ${role}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Select
                          value={selecting[user.id] ?? ""}
                          onValueChange={(value) =>
                            setSelecting((prev) => ({ ...prev, [user.id]: value }))
                          }
                        >
                          <SelectTrigger className="w-36 h-9">
                            <SelectValue placeholder="Role" />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_ROLES.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" onClick={() => void handleAssign(user)}>
                          Atribuir
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Usuarios
