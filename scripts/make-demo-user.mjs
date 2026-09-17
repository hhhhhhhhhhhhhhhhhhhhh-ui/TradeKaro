// Create (or reset) a demo user on the local backend.
// Usage: node scripts/make-demo-user.mjs [username] [password]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const username = process.argv[2] || "demo_local";
const password = process.argv[3] || "Demo@1234";
const base = process.env.BASE || "http://localhost:3000/api/v1";

// Clean any existing user with this name/email, then register fresh.
const f = "data/auth/users.json";
try {
  let users = JSON.parse(readFileSync(f, "utf8"));
  if (!Array.isArray(users) && users?.value) users = users.value; // heal wrapped store
  users = users.filter(
    (u) =>
      u && u.username !== username && u.email !== `${username}@trade.local`,
  );
  writeFileSync(f, JSON.stringify(users, null, 2));
  console.log(`store cleaned — ${users.length} users remain`);
} catch {
  console.log("no users file yet");
}

const hash = createHash("sha256").update(password).digest("hex");
const post = (path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const reg = await post("/register", {
  username,
  email: `${username}@trade.local`,
  password: hash,
});
console.log("register:", reg.status, await reg.text());

const log = await post("/login", { username, password: hash });
const j = await log.json();
console.log("login:", log.status, "tokenLen:", String(j?.token || "").length);
console.log(
  log.status === 200
    ? `\n✅ ${username} ready — sign in with password: ${password}`
    : "\n❌ login failed",
);
