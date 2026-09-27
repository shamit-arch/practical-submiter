// Node entry point for building the Word document; the implementation is shared with
// the browser app in public/lib/document.js.
const { buildDocument } = require("./public/lib/document");

module.exports = {
  buildDocument: async (opts) => Buffer.from(await buildDocument(opts)),
};
