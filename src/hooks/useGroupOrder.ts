import { useState, useEffect, useCallback } from "react";
import { TASK_SUBJECT_GROUPS, type TaskSubjectGroup } from "../utils/taskGrouping";
import { loadGroupSortOrder, saveGroupSortOrder } from "../data/appSettingsRepository";

const DEFAULT_ORDER = TASK_SUBJECT_GROUPS.map((g) => g.key);

function isValidOrder(order: unknown): order is TaskSubjectGroup[] {
  if (!Array.isArray(order)) return false;
  const keys = new Set(DEFAULT_ORDER);
  return order.length === keys.size && (order as string[]).every((k) => keys.has(k as TaskSubjectGroup));
}

export function useGroupOrder() {
  const [order, setOrder] = useState<TaskSubjectGroup[]>(DEFAULT_ORDER);

  useEffect(() => {
    loadGroupSortOrder().then((saved) => {
      if (isValidOrder(saved)) setOrder(saved);
    });
  }, []);

  const updateOrder = useCallback(async (newOrder: TaskSubjectGroup[]) => {
    setOrder(newOrder);
    await saveGroupSortOrder(newOrder);
  }, []);

  return { order, updateOrder };
}
