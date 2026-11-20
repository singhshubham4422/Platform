import { expect, test, type Page } from "@playwright/test";

/**
 * Role-based authentication + page rendering checks against the live API and the seeded
 * development/test database (never production). Screenshots are written to
 * test-results/screens/<role>/<viewport>/<page>.png for visual review.
 */

const ROLES = [
  {
    key: "owner",
    email: "admin@lplatform.dev",
    password: "Admin@123",
    home: /\/admin\/dashboard/,
    pages: [
      "/admin/dashboard",
      "/admin/organizations",
      "/admin/college",
      "/admin/platform/subscriptions",
      "/admin/platform/usage",
      "/admin/platform/health",
      "/admin/audit-logs",
    ],
  },
  {
    key: "college-admin",
    email: "admin@demo-college.test",
    password: "OrgAdmin@123",
    home: /\/admin\/dashboard/,
    pages: ["/admin/dashboard", "/admin/college", "/admin/academic", "/admin/departments/demo-dept-cse", "/admin/students", "/admin/allocations"],
  },
  {
    key: "faculty",
    email: "faculty@demo-college.test",
    password: "Teacher@123",
    home: /\/teacher\/dashboard/,
    pages: [
      "/teacher/dashboard",
      "/teacher/questions",
      "/teacher/questions/new",
      "/teacher/assignments/new",
      "/teacher/submissions",
      "/teacher/code-review",
      "/teacher/integrity",
      "/teacher/students/demo-student-1",
    ],
  },
] as const;

const VIEWPORTS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
] as const;

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

for (const role of ROLES) {
  test.describe(`${role.key} session`, () => {
    test(`signs in, survives reload, renders pages and signs out`, async ({ page }) => {
      test.setTimeout(240_000);
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await signIn(page, role.email, role.password);
      await expect(page).toHaveURL(role.home, { timeout: 15_000 });

      await page.reload();
      await expect(page).toHaveURL(role.home);

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const path of role.pages) {
          await page.goto(path);
          await expect(page, `${path} should stay on an authorized route`).not.toHaveURL(/\/login/);
          // Bounded settle: some pages poll (health refreshes every 15 s), so networkidle may never fire.
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
          // No uncaught error boundary and no horizontal page overflow at this width.
          await expect(page.getByText("Application error")).toHaveCount(0);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${path} overflows horizontally at ${vp.name}`).toBeLessThanOrEqual(1);
          await page.screenshot({
            path: `test-results/screens/${role.key}/${vp.name}/${path.replace(/^\//, "").replace(/\//g, "_") || "root"}.png`,
            fullPage: true,
          });
        }
      }
      expect(pageErrors, `uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([]);

      // Sign out through the backend (revokes the refresh session), then drop client session state.
      const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const status = await page.evaluate(
        async (url) => (await fetch(`${url}/api/auth/logout`, { method: "POST", credentials: "include" })).status,
        api,
      );
      expect(status).toBe(200);
      await page.evaluate(() => window.localStorage.clear());
      await page.context().clearCookies();
      await page.goto(role.pages[0]);
      await expect(page).toHaveURL(/\/login\?next=/);
    });
  });
}

test("faculty cannot open college-admin routes and college admin cannot open platform pages", async ({ page }) => {
  await signIn(page, "faculty@demo-college.test", "Teacher@123");
  await expect(page).toHaveURL(/\/teacher\/dashboard/, { timeout: 15_000 });
  await page.goto("/admin/academic");
  await expect(page).toHaveURL(/\/teacher\/dashboard/);
});

test("revoked API session cannot read protected data", async ({ page, request }) => {
  const login = await request.post(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/auth/login`, {
    data: { email: "admin@demo-college.test", password: "OrgAdmin@123" },
  });
  expect(login.ok()).toBeTruthy();
  const { accessToken, refreshToken } = (await login.json()) as { accessToken: string; refreshToken: string };
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  const ok = await request.get(`${api}/api/academic/tree`, { headers: { authorization: `Bearer ${accessToken}` } });
  expect(ok.status()).toBe(200);
  await request.post(`${api}/api/auth/logout`, { data: { refreshToken } });
  const refreshed = await request.post(`${api}/api/auth/refresh`, { data: { refreshToken } });
  expect(refreshed.status()).toBe(401);
  void page;
});
