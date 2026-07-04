import type { ServiceStatus } from "../types";

interface Props {
  status: ServiceStatus;
  label?: string;
  showLabel?: boolean;
}

const labels: Record<ServiceStatus, string> = {
  online: "Online",
  offline: "Offline",
  checking: "Ellenőrzés...",
};

export default function StatusBadge({ status, label, showLabel = true }: Props) {
  const badgeClass =
    status === "online"
      ? "badge badge-green"
      : status === "offline"
      ? "badge badge-red"
      : "badge badge-amber";

  const dotClass =
    status === "online"
      ? "dot dot-green"
      : status === "offline"
      ? "dot dot-red"
      : "dot dot-amber";

  return (
    <span className={badgeClass}>
      <span className={dotClass} aria-hidden="true" />
      {showLabel && <span>{label ?? labels[status]}</span>}
    </span>
  );
}
