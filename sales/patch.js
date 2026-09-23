// Surgical update of sales/index.html.
// The file was reformatted by prettier, so match on short unique section markers
// rather than reproducing whole blocks.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "index.html");
let h = fs.readFileSync(file, "utf8");

const NEW_MOBILE = `<!-- ═══ MOBILE ═══ -->
    <section id="mobile">
      <div class="wrap">
        <div class="sec-head">
          <span class="eyebrow">Mobile</span>
          <h2>Trade from your pocket.</h2>
          <p class="lede">
            The same terminal on a 390px phone — not a cut-down view. A thumb-friendly
            bottom dock, a bottom-sheet position view, and full-width tap targets.
            Every frame below is a real capture.
          </p>
        </div>

        <h3 style="font-size: 21px">Positions, on a phone</h3>
        <p class="lede" style="font-size: 14px; margin-top: 8px">
          Tap a row and the whole position opens as a bottom sheet: live price and day
          change, bid/ask, the session's range, current P&amp;L, and the three actions.
        </p>
        <div class="phones" style="margin-top: 20px">
          <div class="phone"><div class="frame"><img class="l" src="shots/positions-mobile.jpg" alt="Positions list on mobile" /></div><div class="label">The book</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/position-sheet-mobile.jpg" alt="Position sheet on mobile" /></div><div class="label">Tap a row → position sheet</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/position-partial-exit-mobile.jpg" alt="Partial exit on mobile" /></div><div class="label">Arm Partial Exit → stepper</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/position-add-more-mobile.jpg" alt="Add more on mobile" /></div><div class="label">Or scale in with Add More</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/positions-ledger-mobile.jpg" alt="Margin ledger on mobile" /></div><div class="label">Margin ledger, expanded</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/positions-closed-mobile.jpg" alt="Closed round-trips on mobile" /></div><div class="label">Closed round-trips</div></div>
        </div>

        <div class="callout" style="margin-top: 6px">
          <h3>Three taps from book to exit</h3>
          <ol class="pin-list">
            <li><i>1</i><span><b>Tap the row.</b> The sheet opens with the live price, day change, BID/ASK and the session's OHLC already on screen.</span></li>
            <li><i>2</i><span><b>Arm the action.</b> Partial Exit or Add More turns solid and reveals a quantity stepper, pre-filled to half the holding. Partial exit can never reach the full quantity — a partial exit has to leave something behind.</span></li>
            <li><i>3</i><span><b>Confirm.</b> The fill lands, the row updates, and the P&amp;L, the margin ledger and the wallet all move together.</span></li>
          </ol>
        </div>

        <h3 style="font-size: 21px; margin-top: 40px">Placing a trade</h3>
        <p class="lede" style="font-size: 14px; margin-top: 8px">
          The order ticket, the option chain and the commodity board, all on the same
          streaming feed as the desktop terminal.
        </p>
        <div class="phones" style="margin-top: 20px">
          <div class="phone"><div class="frame"><img class="l" src="shots/stock-ticket-mobile.jpg" alt="Order ticket on mobile" /></div><div class="label">Stock order ticket</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/options-mobile.jpg" alt="Option chain on mobile" /></div><div class="label">Option chain</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/commodities-mobile.jpg" alt="Commodities on mobile" /></div><div class="label">Commodities</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/dashboard-mobile.jpg" alt="Dashboard on mobile" /></div><div class="label">Dashboard</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/watchlist-mobile.jpg" alt="Watchlist on mobile" /></div><div class="label">Watchlist</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/screener-mobile.jpg" alt="Screener on mobile" /></div><div class="label">Screener</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/topmovers-mobile.jpg" alt="Top movers on mobile" /></div><div class="label">Top movers</div></div>
        </div>

        <h3 style="font-size: 21px; margin-top: 40px">Everything else, on the same phone</h3>
        <p class="lede" style="font-size: 14px; margin-top: 8px">
          Orders, wallet, ledger, profile, security, the admin console and the partner
          platform — no page is desktop-only.
        </p>
        <div class="phones" style="margin-top: 20px">
          <div class="phone"><div class="frame"><img class="l" src="shots/orders-mobile.jpg" alt="Orders on mobile" /></div><div class="label">Order history</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/wallet-mobile.jpg" alt="Wallet on mobile" /></div><div class="label">Wallet</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/ledger-mobile.jpg" alt="Ledger on mobile" /></div><div class="label">Ledger</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/portfolio-mobile.jpg" alt="Portfolio on mobile" /></div><div class="label">Portfolio</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/news-mobile.jpg" alt="News on mobile" /></div><div class="label">News</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/profile-mobile.jpg" alt="Profile on mobile" /></div><div class="label">Profile &amp; KYC</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/settings-mobile.jpg" alt="Settings on mobile" /></div><div class="label">Settings</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/connect-mobile.jpg" alt="Connect on mobile" /></div><div class="label">Connect account</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/home-mobile.jpg" alt="Landing on mobile" /></div><div class="label">Public landing</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/admin-mobile.jpg" alt="Admin on mobile" /></div><div class="label">Admin console</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/partner-dashboard-mobile.jpg" alt="Partner dashboard on mobile" /></div><div class="label">Partner dashboard</div></div>
          <div class="phone"><div class="frame"><img class="l" src="shots/partner-links-mobile.jpg" alt="Partner links on mobile" /></div><div class="label">Partner links</div></div>
        </div>
      </div>
    </section>

    `;

const DEEP = `<!-- ═══ ADMIN DEEP DIVE ═══ -->
    <section id="operations">
      <div class="wrap">
        <div class="sec-head">
          <span class="eyebrow">Operations, in depth</span>
          <h2>The parts that actually run a business.</h2>
          <p class="lede">
            Compliance, money in, money out, and a payment rail you can point anywhere.
            These are the systems behind the console, not just the buttons on it.
          </p>
        </div>

        <h3 style="font-size: 23px">The KYC system</h3>
        <p class="lede" style="font-size: 14.5px">
          A gated lifecycle, not a checkbox. Documents are captured, queued, reviewed and
          decided on — and the decision then follows the user through every money path.
        </p>
        <div class="grid-4" style="margin-top: 22px">
          <div class="card"><h3><span class="ico">1</span> Capture</h3><p>The user submits identity and document details from their profile, in a flow they can leave and resume.</p></div>
          <div class="card"><h3><span class="ico">2</span> Queue</h3><p>Submissions land in an operator queue with a status. Nothing is ever auto-approved.</p></div>
          <div class="card"><h3><span class="ico">3</span> Decide</h3><p>Approve, or reject with a reason — and that reason is shown to the user, so a rejection is actionable instead of a dead end.</p></div>
          <div class="card"><h3><span class="ico">4</span> Override</h3><p>Any single account can be exempted from the withdrawal-KYC rule either way. The per-user override always beats the platform switch.</p></div>
        </div>

        <div class="grid-2" style="margin-top: 20px">
          <div class="callout">
            <h3>Gated on how much they've deposited</h3>
            <p style="margin-top: 10px; font-size: 13.5px; color: var(--ink-2)">
              KYC can require a minimum total deposit before it can be completed, or be open
              to everyone. That deposit gate is the only real anti-fraud control on the
              money-out path, which is exactly why "withdrawal requires KYC" ships switched
              <b style="color: var(--ink)">on</b> — without it, an account can be funded and
              emptied again before any paperwork exists.
            </p>
          </div>
          <div class="callout">
            <h3>Banning and KYC are separate states</h3>
            <p style="margin-top: 10px; font-size: 13.5px; color: var(--ink-2)">
              An operator can pause a bad actor without muddying the compliance record, and a
              corrected application can be resubmitted. The wallet refuses a withdrawal the
              moment either gate fails, and tells the user which one it was.
            </p>
          </div>
        </div>

        <h3 style="font-size: 23px; margin-top: 52px">The deposit &amp; withdrawal system</h3>
        <p class="lede" style="font-size: 14.5px">
          A payment rail that ships switched off. While the master switch is off every
          payment route refuses, so the rail can be wired up and tested long before it
          touches live money.
        </p>
        <div class="grid-3" style="margin-top: 22px">
          <div class="card"><h3><span class="ico">⬇️</span> Deposits</h3><p>The user creates a pay-in and is sent to the gateway. The balance is credited only when a signed webhook confirms it. Min and max limits are platform settings, not hardcoded.</p></div>
          <div class="card"><h3><span class="ico">⬆️</span> Withdrawals</h3><p>A separate rail: its own switch, its own limits and its own approval queue. Requests go to an operator rather than straight out of the door.</p></div>
          <div class="card"><h3><span class="ico">🏦</span> Payout accounts</h3><p>Users save a bank or UPI destination once, then withdraw to it in a single step.</p></div>
          <div class="card"><h3><span class="ico">🔏</span> Signed callbacks</h3><p>Every callback is verified against a webhook secret. A forged callback declaring a large top-up settled is refused outright — without this, a stranger could credit their own account.</p></div>
          <div class="card"><h3><span class="ico">🙈</span> Write-only secrets</h3><p>Gateway keys can be replaced from the console but never read back — the API returns them masked, so a support screenshot can't leak a key.</p></div>
          <div class="card"><h3><span class="ico">🧮</span> Ledger is the truth</h3><p>The withdrawable balance is checked against the trading ledger, so the cash panel and the book can't drift apart.</p></div>
        </div>

        <h3 style="font-size: 23px; margin-top: 52px">Bring your own gateway</h3>
        <p class="lede" style="font-size: 14.5px">
          The payment provider is a configuration row, not a code path. Any provider that
          follows the same pay-in / pay-out / signed-webhook shape will drop in — a local
          gateway, a regional one, or your own.
        </p>
        <div class="split" style="margin-top: 24px">
          <div>
            <ul class="pin-list">
              <li><i>1</i><span><b>API base URL</b> — an editable field in the console. Point it at your own gateway or at a sandbox.</span></li>
              <li><i>2</i><span><b>Pay-in key &amp; secret</b> — the pair that creates deposits.</span></li>
              <li><i>3</i><span><b>Pay-out key</b> — a <em>separate</em> pair for withdrawals, because the two are decided by different things.</span></li>
              <li><i>4</i><span><b>Webhook secret</b> — a third secret, used only to verify inbound callbacks. Reusing the pay-in secret here rejects every callback as a bad signature, which looks exactly like callbacks never arriving.</span></li>
              <li><i>5</i><span><b>Superadmin-gated</b> — the base URL is editable only by a superadmin, and warns when it is not the provider's default.</span></li>
            </ul>
            <div class="pills">
              <span class="pill on">Own gateway</span>
              <span class="pill on">Third-party gateway</span>
              <span class="pill on">Sandbox</span>
              <span class="pill on">Separate pay-in / pay-out rails</span>
              <span class="pill on">Master switch</span>
            </div>
          </div>
          <figure style="margin: 0">
            <div class="shot">
              <div class="bar-dots"><i></i><i></i><i></i><u>/admin · finance · gateway</u></div>
              <img class="l" src="shots/admin-light.jpg" alt="Payment gateway settings in the admin console" />
              <img class="d" src="shots/admin-dark.jpg" alt="Payment gateway settings in the admin console, dark" />
            </div>
            <figcaption>Gateway credentials and limits live in the Finance section of the console.</figcaption>
          </figure>
        </div>

        <h3 style="font-size: 23px; margin-top: 52px">The rest of the operator toolkit</h3>
        <div class="grid-3" style="margin-top: 20px">
          <div class="card"><h3><span class="ico">📊</span> Analytics</h3><p>Platform reporting over the same data the console acts on.</p></div>
          <div class="card"><h3><span class="ico">🗂️</span> Directory &amp; clients</h3><p>Client records with bulk operations for day-to-day work.</p></div>
          <div class="card"><h3><span class="ico">🌙</span> MIS sweep</h3><p>A dedicated operator action to run the intraday square-off on demand, as well as on the schedule.</p></div>
          <div class="card"><h3><span class="ico">🧮</span> Affiliate reconcile</h3><p>Recompute partner commission from the source events, so a rate change or a backfill gets settled rather than argued about.</p></div>
          <div class="card"><h3><span class="ico">🔑</span> Password &amp; sessions</h3><p>Operator password management, plus per-device session listing with revoke-one and revoke-all.</p></div>
          <div class="card"><h3><span class="ico">🌐</span> Public config</h3><p>One endpoint hands the app its non-secret switches — fees, limits, feature flags — and never a credential.</p></div>
        </div>
      </div>
    </section>

    `;

// 1) swap the mobile section for the grouped version
const mStart = h.indexOf("<!-- ═══ MOBILE ═══ -->");
const mEnd = h.indexOf("<!-- ═══", mStart + 30);
if (mStart < 0 || mEnd < 0) throw new Error("mobile anchors not found");
h = h.slice(0, mStart) + NEW_MOBILE + h.slice(mEnd);

// 2) insert the deep-dive section before the partner section
const pStart = h.indexOf("<!-- ═══ PARTNER ═══ -->");
if (pStart < 0) throw new Error("partner anchor not found");
h = h.slice(0, pStart) + DEEP + h.slice(pStart);

// 3) add a nav link
h = h.replace(
  '<a href="#admin">Admin</a>',
  '<a href="#admin">Admin</a>\n          <a href="#operations">Operations</a>',
);

fs.writeFileSync(file, h);
console.log("updated. lines:", h.split("\n").length);
