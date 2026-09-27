// Local static server for the app in public/ (the same files Cloudflare Pages serves).
// All processing happens in the browser; this only serves files, on localhost.
const express = require("express");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 4173;
app.listen(PORT, "127.0.0.1", () => console.log(`Practical report app running at http://localhost:${PORT} (offline, local only)`));
