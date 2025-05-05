export const ORDER_STATUSES = Object.freeze([
  "Pending",
  "Processing",
  "Delivered",
  "Cancel",
] as const);

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Pending: ["Processing", "Cancel"],
  Processing: ["Delivered", "Cancel"],
  Delivered: [],
  Cancel: [],
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  Pending: "orange",
  Processing: "blue",
  Delivered: "green",
  Cancel: "red",
};

export function isValidStatus(status: string): status is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(status);
}

export function canTransition(from: string, to: string): boolean {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(status: string): OrderStatus[] {
  return isValidStatus(status) ? [...TRANSITIONS[status]] : [];
}

export function statusColor(status: string): string {
  return isValidStatus(status) ? STATUS_COLORS[status] : "gray";
}

export function isClosed(status: string): boolean {
  return status === "Delivered" || status === "Cancel";
}
