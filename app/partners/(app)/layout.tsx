"use client";

import PanelShell from "../PanelShell";
import { PartnerProvider } from "../lib/store";

// Every approved-partner page renders inside the shell. The proxy has already
// refused anonymous visitors, so this file only has to lay out the chrome.
export default function PartnerAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PartnerProvider>
      <PanelShell>{children}</PanelShell>
    </PartnerProvider>
  );
}
