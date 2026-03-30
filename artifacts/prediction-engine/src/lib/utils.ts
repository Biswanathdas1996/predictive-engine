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

/**
 * List endpoints should return a JSON array, but clients may see wrapped shapes
 * ({ data: [...] }) or array-like values without Array.prototype.map. Coerce to a
 * plain Array via Array.from so .map is always safe.
 */
export function normalizeApiArray<T>(value: unknown): T[] {
  let candidate: unknown = value;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    const data = (candidate as { data?: unknown }).data;
    if (Array.isArray(data)) candidate = data;
  }
  return Array.isArray(candidate) ? Array.from(candidate as T[]) : [];
}
