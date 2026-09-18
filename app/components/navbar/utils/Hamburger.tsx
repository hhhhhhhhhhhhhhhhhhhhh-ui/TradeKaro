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

  let options = [
    {
      title: "Positions",
      id: 0,
      href: "/positions",
    },
    {
      title: "Portfolio",
      id: 1,
      href: "/portfolio",
    },
    {
      title: "Watchlist",
      id: 2,
      href: "/watchlist",
    },
    {
      title: "Top movers",
      id: 3,
      href: "/topmovers",
    },
    {
      title: "Screener",
      id: 5,
      href: "/screener",
    },
    {
      title: "Options",
      id: 6,
      href: "/options",
    },
    {
      title: "Commodities",
      id: 11,
      href: "/commodities",
    },
    {
      title: "News",
      id: 12,
      href: "/news",
    },
    {
      title: "Profile",
      id: 7,
      href: "/profile",
    },
    {
      title: "Connect account",
      id: 10,
      href: "/connect",
    },
    {
      title: "Ledger",
      id: 8,
      href: "/ledger",
    },
    {
      title: "Settings",
      id: 9,
      href: "/settings",
    },
    {
      title: "Log out",
      id: 4,
      href: "/logout",
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
            className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-lg border border-border bg-popover py-1 shadow-lg focus:outline-none"
            style={{
              transform: isOpen
                ? "translateY(0) scale(1)"
                : "translateY(-10px) scale(0.9)",
              opacity: isOpen ? "1" : "0",
              transition: "all 0.3s ease-in-out",
            }}
          >
            <div
              className="flex flex-col gap-y-0.5 transition-all duration-300 ease-in-out"
              role="none"
            >
              {options.map((option) => (
                <NavTransition
                  key={option.id}
                  href={option.href}
                  onClick={() => setIsOpen(false)}
                  className={`${dropdownClass} ${
                    option.title === "Log out"
                      ? "text-negative"
                      : "text-popover-foreground"
                  }`}
                >
                  {option.title}
                </NavTransition>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
