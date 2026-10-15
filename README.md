# Practical Report Builder

Dump every screenshot from your lab practicals into one page. A small AI model **running in
your browser** labels each one as **source code** or **output**, splits them into practicals,
and builds a formatted Word document (cover page, index table, one practical per page,
Aim / Source Code / Output).

Nothing is uploaded: the model, PDF reading and Word generation all run on your device.
It is a static site, so you can run it locally or host it for free on Cloudflare Pages.
Once the page has loaded, it keeps working offline.

- [Use it](#use-it)
- [Run locally](#run-locally)
- [Deploy to Cloudflare Pages](#deploy-to-cloudflare-pages)
- [The model](#the-model)
- [Project layout](#project-layout)

## Use it

1. Fill in **Report details** on the left: your name (required), batch, enrollment number,
   and optionally the subject and institute. They're remembered in your browser for next time.
2. *(optional)* Add the practical-list PDF (click the PDF box or drop it anywhere). The aims and
   the practical range are filled in from it. Numbered lists (`31.`, `31)`, `Practical 31:`)
   and table layouts (`31 | Write a …`) both work.
3. Drop, browse or paste (Ctrl+V) all screenshots in order. They're grouped into one card per
   practical, and each has a **CODE | OUTPUT** toggle showing the model's confidence.
   - Screenshots the model is unsure about are marked **Check**. **Review N to check** steps
     through only those, full-screen: press <kbd>C</kbd> or <kbd>O</kbd> to label and move on.
   - A new practical starts wherever code follows output. Hover between two screenshots and
     click ✂ to split, or use **Merge with previous** on a practical.
   - Click, Ctrl+click or Shift+click to select several, then use the action bar at the bottom.
   - Drag thumbnails to reorder, type aims inline, and undo anything with Ctrl+Z.
4. Click **Generate .docx** in the top bar (or press Ctrl+Enter).

Keyboard shortcuts (press <kbd>?</kbd> in the app for the full list): arrows move, <kbd>C</kbd> /
<kbd>O</kbd> label, <kbd>Space</kbd> flips, <kbd>S</kbd> splits, <kbd>M</kbd> merges,
<kbd>Del</kbd> removes, <kbd>Enter</kbd> opens full-screen review.

The theme button in the top bar switches between Auto (follows your system), Light and Dark.

### Sign-in (not enabled)

`public/login.html` is a sign-in page (sign-in only — accounts are added by the administrator)
kept for a future version. Nothing links to it and the app doesn't require it. See
`public/lib/auth.js` for how to connect it to a backend.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:4173. `npm start` runs the build (below) and then serves `public/` on
localhost only.

## Deploy to Cloudflare Pages

The deployable site is the `public/` folder after running `npm run build`. The build copies
the browser builds of docx and pdf.js into `public/vendor/`, copies the trained model into
`public/model/`, and generates the offline service worker `public/sw.js`. These generated
files are git-ignored, so Cloudflare runs the build itself.

### Option A — Connect the Git repository (recommended)

Every push to your production branch redeploys automatically.

1. Push this project to a GitHub or GitLab repository. `ml/model.json` and
   `ml/training-set.json` must be committed, because the build copies them.
2. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to **Workers & Pages** →
   **Create application** → **Pages** → **Connect to Git**.
3. Authorise GitHub/GitLab, pick the repository, then **Begin setup**.
4. Fill in the build settings:

   | Field | Value |
   |---|---|
   | Project name | e.g. `practical-report-builder` (becomes `practical-report-builder.pages.dev`) |
   | Production branch | `main` |
   | Framework preset | **None** |
   | Build command | `npm run build` |
   | Build output directory | `public` |
   | Root directory (advanced) | leave empty, or the sub-folder if this project isn't the repo root |

   You don't need any environment variables. The Node version comes from `.nvmrc` (22). To
   override it, set `NODE_VERSION` under **Settings → Environment variables**.
5. Click **Save and Deploy**. When the build log shows `Built public/ — 13 files …`, open
   **Continue to project** to find your `*.pages.dev` URL.

### Option B — Direct upload from your computer (no Git)

```bash
npm install
npm run build
npx wrangler login
npx wrangler pages deploy public --project-name practical-report-builder
```

The first deploy creates the project. Run the last two commands again to publish updates.
You can also drag and drop the built `public/` folder in the dashboard: **Workers & Pages** →
**Create application** → **Pages** → **Upload assets**. You must run `npm run build` first,
otherwise the model and vendor files are missing.

### After deploying

- **Custom domain:** in the project, open **Custom domains** → **Set up a custom domain**.
- **Offline use:** open the site once while online. The service worker then caches the whole
  app, about 3 MB, and it works without internet. Each deploy changes the cache version, so
  visitors get the new version on their next visit. Service workers need HTTPS, which
  `*.pages.dev` provides, so offline caching is skipped on `http://localhost`.
- **Headers:** `public/_headers` stops browsers caching `sw.js` and the model files, so
  updates show up straight away.
- **Updating the model:** run `npm run train`, commit `ml/model.json` and
  `ml/training-set.json`, then push (Option A) or redeploy (Option B).

### Troubleshooting

| Symptom | Fix |
|---|---|
| Page shows *Model unavailable: model/model.json not found* | The build didn't run. Check the build command is `npm run build` and the output directory is `public`. |
| Build fails with *Missing ml/model.json* | Commit `ml/model.json` and `ml/training-set.json`, or run `npm run train` and push them. |
| *Could not read the PDF* | Check that `/vendor/pdf.min.mjs` and `/vendor/pdf.worker.min.mjs` load in the browser's Network tab. |
| Old version still showing | Reload once (the new service worker activates on the next load) or hard refresh (Ctrl+Shift+R). |

## The model

`public/lib/` holds a small decision engine that follows the workflow of TypeSafe's Jev. You
pass `state` plus named `questions`, and get back structured answers with probabilities
instead of text:

```js
const jev = new PRB.jev.LocalJev(modelJson, extractFeatures);
const res = await jev.systemOne({
  state: { screenshots: [file1, file2, file3], practicalCount: 2 },
  questions: {
    kind: PRB.jev.choice("Source code or output?", { code: null, output: null }),
    startsPractical: PRB.jev.noul("Does this screenshot begin a new practical?"),
  },
});
res.answers[0].kind;            // { type: "choice", choice: "code", confidence: 0.99, probabilities: { code: 0.99, output: 0.01 } }
res.answers[2].startsPractical; // { type: "noul", noul: 0.97 }
```

It only answers the two questions it was trained for. Any other question throws an
`UnsupportedQuestionError` instead of guessing. The same code runs in Node (`ml/jev-local.js`
loads it with an image decoder), which is how the tests exercise it.

| Stage | File | What it does |
|---|---|---|
| Features | `public/lib/features.js` | 33 layout and colour cues per image: syntax-highlight hues per line, line-number gutter, indentation levels, line pitch, column alignment, background panels, … |
| Classifier | `public/lib/mlp.js` | A small neural network (33 → 24 ReLU → softmax), pure JavaScript |
| Sequence | `public/lib/jev.js` | A 2-state HMM over the screenshot order (code is usually followed by its output). When the practical count is known, it picks the most likely labelling with exactly that many practicals, but never overrules a confident label |

### Training

```bash
npm run train
```

This renders 2,400 synthetic screenshots in Node, with realistic scaling, cropping and JPEG
artefacts, and trains on them. It takes about 2 minutes the first time and is cached in
`ml/cache/` after that. Code comes from 13 editor/IDE themes: VS Code, IntelliJ/Darcula,
Eclipse, Turbo C, Notepad, Notepad++, IDLE, Code::Blocks and others. Output comes from cmd,
PowerShell, Linux terminals, IDE run consoles, IDLE, Jupyter, web pages, GUI windows and
plots. It writes `ml/model.json` and `ml/training-set.json`.

Latest run:

- **97.0%** on freshly generated screenshots in styles the model was trained on
- **90.3%** on five editor/terminal styles held out of training entirely
- **79.8%** of simulated whole reports have every practical grouped correctly when the practical count is known (65.0% using image predictions alone)

These are synthetic benchmarks. To teach the model your real screenshots:

- **In the browser:** labels you flip are saved as training examples when you generate. Then
  click **Retrain model**, which takes a few seconds. The retrained model and corrections stay
  in that browser only; **Reset** forgets them.
- **For everyone who uses your deployment:** put real screenshots in `training-data/code/`
  and `training-data/output/`, run `npm run train`, and redeploy. The report also shows
  accuracy on those images before they are trained on. Each real screenshot counts 8× a
  synthetic one.

To see what the app will extract from a practical-list PDF:

```bash
node parsePdf.js "Practical List.pdf"
```

## Project layout

```
public/            the static site (what Cloudflare Pages serves)
  index.html, app.js, style.css, _headers
  login.html, login.js   sign-in page, not in use yet
  lib/             shared browser + Node code: features, mlp, jev, aims, document
                   (browser-only: theme, auth)
  vendor/ model/ sw.js   generated by `npm run build` (git-ignored)
ml/                Node-only training: synthetic screenshot renderer, dataset, trainer
  model.json, training-set.json   trained model (committed)
scripts/build.js   prepares public/ for deployment
server.js          local static server for `npm start`
test/              `npm test`
```

## Tests

```bash
npm test
```
