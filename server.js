const express = require("express");
const multer = require("multer");
const sizeOf = require("image-size").imageSize || require("image-size");
const path = require("path");
const { extractAimsFromPdf } = require("./parsePdf");
const { buildDocument } = require("./generate");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "1mb" }));

app.post("/api/parse-pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });
    const aims = await extractAimsFromPdf(req.file.buffer);
    res.json({ aims });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to parse PDF: " + err.message });
  }
});

function imgTypeFromMime(mime) {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("bmp")) return "bmp";
  return "png";
}

app.post("/api/generate", upload.array("screenshots", 500), async (req, res) => {
  try {
    const { name, batch, enrollment, practicals: practicalsJson } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const perPractical = Math.max(1, parseInt(req.body.perPractical, 10) || 1);
    const firstIsCode = req.body.firstIsCode === "true";
    const practicalsMeta = JSON.parse(practicalsJson);

    const toImg = (f) => {
      const dims = sizeOf(f.buffer);
      return {
        buffer: f.buffer,
        type: imgTypeFromMime(f.mimetype),
        meta: { width: dims.width, height: dims.height },
      };
    };
    const allImages = (req.files || []).map(toImg);

    const practicals = practicalsMeta.map((p, i) => {
      const group = allImages.slice(i * perPractical, i * perPractical + perPractical);
      let codeImages = [];
      let outputImages = [];
      if (perPractical > 1 && firstIsCode && group.length > 0) {
        codeImages = [group[0]];
        outputImages = group.slice(1);
      } else {
        outputImages = group;
      }
      return {
        number: p.number,
        aim: p.aim,
        codeImages,
        outputImages,
      };
    });

    const buffer = await buildDocument({ name, batch, enrollment, practicals });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="Practicals.docx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate document: " + err.message });
  }
});

const PORT = process.env.PORT || 4173;
app.listen(PORT, () => console.log(`Practical report app running at http://localhost:${PORT}`));
