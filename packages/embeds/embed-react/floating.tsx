/**
 * @fileoverview This file is an example file and tells how to use floating popup button in a React application. This is also used by playwright e2e
 */
import { useEffect } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";

import { getCalApi } from "./src/index";

function App() {
  useEffect(() => {
    (async function () {
      const cal = await getCalApi({
        namespace: "floating",
        embedJsUrl: "http://localhost:3000/embed/embed.js",
      });
      cal("floatingButton", {
        calLink: "pro",
        calOrigin: "http://localhost:3000",
        config: {
          theme: "dark",
        },
      });
      cal("ui", { styles: { branding: { brandColor: "#000000" } }, hideEventTypeDetails: false });
    })();
  }, []);
  return null;
}

// React 19 removed ReactDOM.render. createRoot is the replacement, and it
// requires a non-null container, hence the explicit check.
const container = document.getElementById("root");
if (!container) {
  throw new Error("embed-react demo: #root not found");
}
createRoot(container).render(<App />);
