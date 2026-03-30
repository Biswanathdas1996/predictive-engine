import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercent(value: number | undefined | null): string {
  if (value == null) return "0%";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatScore(value: number | undefined | null): string {
  if (value == null) return "0.00";
  return value.toFixed(2);
}
