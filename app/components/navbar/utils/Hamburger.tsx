"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NavTransition } from "../NavTransition";

export default function Hamburger() {
  const [isOpen, setIsOpen] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleClickOutside = (event: any) => {
    if (isOpen && !event.target.closest(".relative")) {
      setIsOpen(false);
    }
  };
  useEffect(() => {
    document.addEventListener("click", handleClickOutside, true);
    return () => {
      document.removeEventListener("click", handleClickOutside, true);
    };
  }, [isOpen, handleClickOutside]);

  let dropdownClass =
    "block px-4 py-2 text-[13px] hover:bg-muted transition-colors rounded-md mx-1";

  // Grouped, and deliberately WITHOUT the three destinations that sit in the
  // bottom dock (Positions, Watchlist, Options). The drawer used to repeat
  // thirteen flat links, three of which the thumb-bar already offered an inch
  // below — the same destination twice on one screen, and two lists to keep in
  // step forever. What is left is what the dock does not cover: browsing the
  // market, and the account/how-am-I-configured end of the product.
  //
  // Positions stays one tap away in the dock centre, so nothing became
  // unreachable by removing it here.
  const groups = [
    {
      title: "Markets",
      items: [
        { title: "Dashboard", href: "/dashboard" },
        { title: "Stocks", href: "/stocks" },
        { title: "Commodities", href: "/commodities" },
        { title: "Screener", href: "/screener" },
        { title: "Top movers", href: "/topmovers" },
        { title: "News", href: "/news" },
      ],
    },
    {
      title: "Account",
      items: [
        { title: "Profile", href: "/profile" },
        { title: "Portfolio", href: "/portfolio" },
        { title: "Ledger", href: "/ledger" },
        { title: "Connect account", href: "/connect" },
        { title: "Settings", href: "/settings" },
        { title: "Log out", href: "/logout", danger: true },
      ],
    },
  ];

  return (
    <div className="flex items-center justify-center">
      <div className="relative inline-block text-left">
        <div>
          <button
            type="button"
            className="inline-flex h-[34px] w-full items-center justify-center rounded-md border border-border px-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            id="menu-button"
            aria-expanded={isOpen}
            aria-haspopup="true"
            onClick={() => setIsOpen(!isOpen)}
          >
            <svg
              className="h-5 w-5 transition-transform duration-300 ease-in-out"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              style={{
                transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        {isOpen && (
          <div
            className="absolute right-0 z-10 mt-2 w-60 origin-top-right rounded-lg border border-border bg-popover py-1.5 shadow-lg focus:outline-none"
            style={{
              transform: isOpen
                ? "translateY(0) scale(1)"
                : "translateY(-10px) scale(0.9)",
              opacity: isOpen ? "1" : "0",
              transition: "all 0.3s ease-in-out",
            }}
          >
            <div
              className="flex flex-col transition-all duration-300 ease-in-out"
              role="none"
            >
              {groups.map((group, gi) => (
                <div key={group.title} role="none">
                  <div
                    className={`px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${
                      gi === 0 ? "pt-1" : "pt-2 border-t border-border mt-1"
                    }`}
                  >
                    {group.title}
                  </div>
                  {group.items.map((item) => (
                    <NavTransition
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      className={`${dropdownClass} ${
                        item.danger
                          ? "text-negative"
                          : "text-popover-foreground"
                      }`}
                    >
                      {item.title}
                    </NavTransition>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
