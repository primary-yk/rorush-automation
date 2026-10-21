#!/bin/bash
# Apply faster rain captcha (dual 2Captcha tasks + faster polling). Run on VPS as root.
set -e
cd /opt/rorush-automation
patch -p1 --forward << 'PATCH' || { echo "Patch may already be applied — continuing"; }
diff --git a/src/automation/rain-captcha.ts b/src/automation/rain-captcha.ts
index 5326f44..9c643c5 100644
--- a/src/automation/rain-captcha.ts
+++ b/src/automation/rain-captcha.ts
@@ -89,29 +89,36 @@ function isWorkerUnsolvableError(err: unknown): boolean {
   );
 }
 
+function rainCaptchaDualStartEnabled(): boolean {
+  const raw = process.env.CAPTCHA_RAIN_DUAL_START?.trim().toLowerCase();
+  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
+  return true;
+}
+
 function rainCaptchaSolveOptions(): CaptchaSolveOptions {
   return {
     cancelAfterMs: Math.max(
-      35_000,
-      Number(process.env.CAPTCHA_RAIN_CANCEL_AFTER_MS ?? 55_000) || 55_000,
+      28_000,
+      Number(process.env.CAPTCHA_RAIN_CANCEL_AFTER_MS ?? 42_000) || 42_000,
     ),
-    taskAttempts: Math.max(2, Number(process.env.CAPTCHA_RAIN_TASK_ATTEMPTS ?? 4) || 4),
+    taskAttempts: Math.max(2, Number(process.env.CAPTCHA_RAIN_TASK_ATTEMPTS ?? 5) || 5),
   };
 }
 
-/** Start a second 2Captcha task if the first is still polling (queue stalls). */
+/** Parallel 2Captcha tasks — first token wins (dual-start + optional late hedge). */
 async function solveRainCaptchaWithHedge(): Promise<string | null> {
   const opts = rainCaptchaSolveOptions();
   const hedgeAfterMs = Math.max(
     0,
-    Number(process.env.CAPTCHA_RAIN_HEDGE_AFTER_MS ?? 40_000) || 40_000,
+    Number(process.env.CAPTCHA_RAIN_HEDGE_AFTER_MS ?? 12_000) || 12_000,
   );
-  if (hedgeAfterMs <= 0) {
-    return solveCaptcha("hcaptcha", opts);
-  }
+  const dualStart = rainCaptchaDualStartEnabled();
 
   return new Promise<string | null>((resolve, reject) => {
     let settled = false;
+    let tasksLaunched = 0;
+    let failures = 0;
+
     const finish = (token: string | null) => {
       if (settled || token == null) return;
       settled = true;
@@ -123,19 +130,26 @@ async function solveRainCaptchaWithHedge(): Promise<string | null> {
       reject(err instanceof Error ? err : new Error(String(err)));
     };
 
-    let failures = 0;
-    const onErr = (err: unknown) => {
-      failures++;
-      if (failures >= 2) fail(err);
+    const launch = (label?: string) => {
+      tasksLaunched++;
+      if (label) console.log(`[rain-captcha] ${label}`);
+      void solveCaptcha("hcaptcha", opts)
+        .then(finish)
+        .catch((err) => {
+          failures++;
+          if (!settled && failures >= tasksLaunched) fail(err);
+        });
     };
 
-    void solveCaptcha("hcaptcha", opts).then(finish).catch(onErr);
+    launch();
+    if (dualStart) launch("dual-start — 2 parallel 2Captcha tasks");
 
-    setTimeout(() => {
-      if (settled) return;
-      console.log("[rain-captcha] hedge solve — primary task still in flight");
-      void solveCaptcha("hcaptcha", { ...opts, taskAttempts: 2 }).then(finish).catch(onErr);
-    }, hedgeAfterMs);
+    if (hedgeAfterMs > 0) {
+      setTimeout(() => {
+        if (settled) return;
+        launch("hedge — extra task (queue still slow)");
+      }, hedgeAfterMs);
+    }
   });
 }
 
@@ -159,7 +173,11 @@ async function solveHcaptchaWithRetry(): Promise<string | null> {
           ? "captcha queue stall"
           : "network";
       console.warn(`[rain-captcha] retry ${attempt + 1}/${maxAttempts} after ${why}…`);
-      await new Promise((r) => setTimeout(r, 2_000));
+      const retryMs = Math.max(
+        400,
+        Number(process.env.CAPTCHA_RAIN_RETRY_MS ?? 800) || 800,
+      );
+      await new Promise((r) => setTimeout(r, retryMs));
     }
   }
   throw lastErr;
diff --git a/src/captcha/solve.ts b/src/captcha/solve.ts
index 741704f..dc77f6d 100644
--- a/src/captcha/solve.ts
+++ b/src/captcha/solve.ts
@@ -259,7 +259,7 @@ async function pollTaskUntilReady(
   taskId: number | string,
   opts: { attempt: number; attempts: number; cancelAfterMs: number },
 ): Promise<string> {
-  const pollMs = Math.max(800, Number(process.env.CAPTCHA_POLL_MS ?? 1000) || 1000);
+  const pollMs = Math.max(400, Number(process.env.CAPTCHA_POLL_MS ?? 500) || 500);
   const maxPolls = Math.max(20, Number(process.env.CAPTCHA_MAX_POLLS ?? 180) || 180);
   const cancelAfterMs = opts.cancelAfterMs;
   const verbose = /^(1|true|yes|on)$/i.test(process.env.CAPTCHA_VERBOSE?.trim() ?? "");
@@ -394,7 +394,11 @@ async function createAndPoll(
       if (attempt < attempts && isCaptchaRetryableTaskError(err)) {
         const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
         console.warn(`[captcha] retrying with new task (${attempt + 1}/${attempts}) after: ${why.slice(0, 100)}`);
-        await new Promise((r) => setTimeout(r, 1_500));
+        const retryDelayMs = Math.max(
+          400,
+          Number(process.env.CAPTCHA_RETRY_DELAY_MS ?? 800) || 800,
+        );
+        await new Promise((r) => setTimeout(r, retryDelayMs));
         continue;
       }
       throw err;
PATCH

grep -q '^CAPTCHA_POLL_MS=' .env 2>/dev/null || cat >> .env << 'EOF'

CAPTCHA_POLL_MS=500
CAPTCHA_RAIN_HEDGE_AFTER_MS=12000
CAPTCHA_RAIN_DUAL_START=1
CAPTCHA_SOLVE_START_LEAD_MS=180000
EOF

npm run build
pm2 restart all --update-env
echo "Done — watch next rain logs for: dual-start"
