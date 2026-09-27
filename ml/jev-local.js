// Node wrapper around the shared decision engine (public/lib/jev.js): loads
// ml/model.json from disk and decodes screenshots with @napi-rs/canvas.
const fs = require("fs");
const path = require("path");
const core = require("../public/lib/jev");
const { featuresFromBuffer } = require("./features");

const MODEL_PATH = path.join(__dirname, "model.json");

class LocalJev extends core.LocalJev {
  constructor({ modelPath = MODEL_PATH } = {}) {
    super(JSON.parse(fs.readFileSync(modelPath, "utf8")), featuresFromBuffer);
    this.modelPath = modelPath;
  }

  reload() {
    this.load(JSON.parse(fs.readFileSync(this.modelPath, "utf8")));
  }
}

module.exports = { ...core, LocalJev, MODEL_PATH };
