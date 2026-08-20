import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type AlertType = "urgent" | "warning" | "info" | "success";

export interface AppAlert {
  id: string;
  type: AlertType;
  title: string;
  description: string;
  read: boolean;
  created_at: string;
}

const alertsKey = ["alerts"] as const;

/** Alertas reais gerados pelo backend (ex.: pagamento falhou e foi estornado). */
export function useAlerts() {
  return useQuery({
    queryKey: alertsKey,
    queryFn: () => api.get<AppAlert[]>("/alerts"),
  });
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: alertsKey });
    },
  });
}
