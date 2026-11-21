"use client";

import { useCallback, useEffect, useState } from "react";
import { contributionRepository, type ContributionQueueQuery, type ContributionQueueResponse } from "@/entities/contribution";

interface QueueState {
  data: ContributionQueueResponse | null;
  error: string | null;
  settledKey: string | null;
}

export function useContributionQueue(query: ContributionQueueQuery) {
  const [refreshTick, setRefreshTick] = useState(0);
  const requestKey = `${JSON.stringify(query)}:${refreshTick}`;
  const [state, setState] = useState<QueueState>({
    data: null,
    error: null,
    settledKey: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    contributionRepository.getQueue(query, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({ data: response, error: null, settledKey: requestKey });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setState((prev) => ({
          data: prev.data,
          error: "Không thể tải danh sách hồ sơ. Vui lòng thử lại.",
          settledKey: requestKey,
        }));
      });
    return () => controller.abort();
  }, [query, refreshTick, requestKey]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  return {
    data: state.data,
    error: state.error,
    isLoading: !state.data && !state.error,
    isRefreshing: Boolean(state.data) && state.settledKey !== requestKey,
    refresh,
  };
}
