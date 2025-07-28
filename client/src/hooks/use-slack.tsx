import { useMutation } from "@tanstack/react-query";
import { slackApi } from "@/services/api";
import { queryClient } from "@/lib/queryClient";

export function useSlack() {
  const setupSlackMutation = useMutation({
    mutationFn: slackApi.setupSlack,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
  });

  return {
    setupSlack: setupSlackMutation,
  };
}