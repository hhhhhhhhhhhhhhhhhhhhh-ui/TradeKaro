"use client";
import { useTheme } from "@/app/components/theme/ThemeProvider";

export interface ChartColors {
  positive: string;
  negative: string;
  border: string;
  foreground: string;
  background: string;
}

const light: ChartColors = {
  positive: "#037a68",
  negative: "#ce0000",
  border: "#374151",
  foreground: "#374151",
  background: "#ffffff",
};

const dark: ChartColors = {
  positive: "#26a69a",
  negative: "#ef5350",
  border: "#2a3035",
  foreground: "#848e9c",
  background: "#151a1e",
};

export function useChartColors(): ChartColors {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? dark : light;
}
