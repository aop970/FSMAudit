import express from "express";
import cors from "cors";
import { runsRouter } from "./routes/runs.ts";
import { findingsRouter } from "./routes/findings.ts";
import { missedRouter } from "./routes/missed.ts";
import { rulesRouter } from "./routes/rules.ts";

const app = express();
const PORT = process.env.PORT ?? 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const AUDIT_API_TOKEN = process.env.AUDIT_API_TOKEN ?? "";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "10mb" }));

// Token auth middleware — skipped if AUDIT_API_TOKEN not set
app.use((req, res, next) => {
  if (!AUDIT_API_TOKEN) return next();
  if (req.path === "/health") return next();
  const token = req.headers["x-audit-token"];
  if (token !== AUDIT_API_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

app.use("/api/runs", runsRouter);
app.use("/api/findings", findingsRouter);
// Missed-finding route mounts under /api/runs/:run_id/missed-finding
app.use("/api/runs", missedRouter);
// Rules route: GET/POST /api/rules, POST /api/rules/reset
app.use("/api/rules", rulesRouter);

app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
});
