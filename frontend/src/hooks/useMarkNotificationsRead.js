import { useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import api from "../api/client"

// Clears the notification dot for a given type (e.g. "TASK", "ANNOUNCEMENT")
// as soon as the matching page is opened, instead of only via /notifications.
export default function useMarkNotificationsRead(type) {
  const qc = useQueryClient()
  const { mutate } = useMutation({
    mutationFn: (t) => api.post("/notifications/read-by-type", { type: t }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] })
      qc.invalidateQueries({ queryKey: ["notifications"] })
    },
  })

  useEffect(() => {
    if (type) mutate(type)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])
}
