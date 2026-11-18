import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

// 開発時 (ES Modules) と本番時 (CommonJS) の両方で安全にパスを解決する
const getDirname = () => {
  try {
    // CommonJS環境（本番ビルド後）では __dirname がグローバル定義されている
    if (typeof __dirname !== "undefined") {
      return __dirname;
    }
  } catch (e) {}

  // ES Modules環境（開発時 tsx 実行など）用
  const filename = fileURLToPath(import.meta.url);
  return path.dirname(filename);
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // 本番環境用の静的ファイル配信
    // esbuildで dist/server.cjs にビルドされるため、getDirname() は /app/applet/dist になります。
    const distPath = path.resolve(getDirname());
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
