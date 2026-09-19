import { redirect } from "next/navigation";

// ── Consolidated into the wallet ────────────────────────────────────────────
//
// Payout destinations used to be edited here AND in the wallet: two screens
// writing one set of data, which is the dangerous kind of duplication. A change
// made in one place could look like it never applied in the other, and only one
// of them was the screen anyone visits when they are thinking about money.
//
// The wallet is the keeper. It is where deposits and withdrawals happen, so it
// is where "my balance and where it goes" already lives.
//
// The route is kept as a redirect rather than deleted, so an existing bookmark,
// a browser-history entry or a link in an old message lands somewhere useful
// instead of on a 404. It is still behind the proxy, so a visitor is sent to
// /login before reaching this.
//
// ⚠️ This page also used to promote bank/UPI details a customer had saved on
// their DEVICE before destinations moved server-side. That promotion now runs
// in the wallet (see LEGACY_BANK_KEY there). It had to be moved rather than
// dropped: without it, anyone who added an account on the old version would
// open their wallet and find their details gone.
//
// The previous implementation is in git history if it is ever needed:
//   git log --follow -- app/profile/banks/page.tsx

export default function LegacyBanksPage() {
  redirect("/wallet");
}
