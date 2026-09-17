"use client";
import { usePathname } from "next/navigation";

export default function HideOnAdmin({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  if (path?.startsWith("/admin")) return null;
  return <>{children}</>;
}
