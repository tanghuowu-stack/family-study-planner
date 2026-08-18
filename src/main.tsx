import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 只在生产注册：开发环境注册会把 dev server 的资源缓存住，改代码看不到效果，徒增困惑。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("[sw] 注册失败（不影响正常使用，只是没有离线能力）", error);
    });
  });
}
