/* eslint-disable @next/next/no-img-element */
"use client";
import { useEffect, useState, useRef } from "react";
import { NavTransition } from "./NavTransition";
import Hamburger from "./utils/Hamburger";
import { getCookie } from "cookies-next";
import { useRouter, usePathname } from "next/navigation";
import { CiSearch } from "react-icons/ci";
import { ThemeToggle } from "@/app/components/theme/ThemeToggle";

const NavbarMobile = (props: any) => {
  const router = useRouter();
  const pathname = usePathname();
  const [logStatus, setLogStatus] = useState(false);
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  async function handleSearch(e: any) {
    e.preventDefault();
    router.push(`/stocks?search=${query}`);
  }

  useEffect(() => {
    const token = getCookie("token") as string | undefined;
    setLogStatus(!!token);
  }, [pathname]);

  const [isVisible, setIsVisible] = useState(false);

  const handleButtonClick = () => {
    setIsVisible(!isVisible);
    if (!isVisible) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsVisible(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 100);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="sticky top-0 z-40 -mx-4 px-4 py-3 bg-background/90 backdrop-blur border-b border-border md:static md:border-0 md:bg-transparent md:backdrop-blur-0 md:mx-0 md:px-0 md:py-4">
      <div className="flex flex-row items-center justify-between">
        <NavTransition className="flex flex-row items-center" href="/">
          <img
            src="/TradeKaroLogo.png"
            alt="TradeKaro Logo"
            className="h-8 !rounded-md"
          />
          <span className="ml-2 font-medium text-foreground">TradeKaro</span>
        </NavTransition>
        <div className="flex flex-row justify-center items-center gap-2">
          <button
            type="button"
            onClick={handleButtonClick}
            aria-label="Toggle search"
            aria-expanded={isVisible}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95 transition-transform"
          >
            <CiSearch className="text-foreground cursor-pointer text-lg" />
          </button>
          <ThemeToggle />
          {!logStatus && (
            <>
              <NavTransition href="/login" className="flex">
                <button
                  type="button"
                  className="flex h-[34px] items-center justify-center rounded-md border border-border px-3 text-[12px] font-semibold text-foreground/80 transition hover:bg-muted"
                >
                  LOGIN
                </button>
              </NavTransition>
              <NavTransition href="/signup" className="hidden sm:flex">
                <button
                  type="button"
                  className="flex h-[34px] items-center justify-center rounded-md border border-foreground bg-foreground px-3 text-[12px] font-semibold text-background transition hover:bg-foreground/90"
                >
                  SIGN UP
                </button>
              </NavTransition>
            </>
          )}
          {logStatus && <Hamburger />}
        </div>
      </div>
      <div
        className={`search-bar overflow-hidden transition-all duration-200 flex flex-row border px-3 items-center ${
          isFocused
            ? "border-foreground"
            : "border-border hover:border-foreground"
        } ${isVisible ? "mt-3 h-[44px] opacity-100" : "mt-0 h-0 opacity-0 border-transparent"}`}
      >
        <form
          className="flex flex-row w-full justify-between h-full items-center"
          onSubmit={handleSearch}
        >
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="h-full w-full border-none bg-transparent px-2 text-base text-foreground placeholder:text-muted-foreground focus:border-none focus:outline-none md:text-[13px]"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search stocks (Ctrl+K)"
          />
          <button type="submit" className="my-auto">
            <CiSearch className="hover:text-brand text-foreground" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default NavbarMobile;
