import argparse
import functools
import http.server
import json
import os
import posixpath
import re
import socketserver
import sys
import webbrowser
from pathlib import Path

REQUIRED_JSX = [
    "ShadokuArt.jsx",
    "ShadokuGame.jsx",
    "ShadokuHome.jsx",
    "ShadokuApp.jsx",
]
# The engine's output is the only source of case JSONs; the app imports them as ./puzzles/<file>.
ENGINE_DIR = Path(__file__).resolve().parent.parent / "engine"
PUZZLE_DIRS = [ENGINE_DIR / "puzzles", ENGINE_DIR / "puzzles_multi"]
JSON_PUZZLES = ["shadoku_tutorial.json"] + [f"shadoku_case{i}.json" for i in range(1, 11)] + ["shadoku_MAH1010QAR3-4101.json", "shadoku_MAX1111RAR5-4201.json"]
CODE_EXTS = {".jsx", ".js", ".ts", ".tsx", ".mjs", ".cjs"}
DATA_EXTS = {".json"}
ASSET_EXTS = {".svg"}

IMPORT_RE = re.compile(
    r"""(?:import\s+(?:[\w*\s{},]*\s+from\s+)?|export\s+[\w*\s{},]*\s+from\s+|require\s*\(\s*)["']([^"']+)["']""",
    re.MULTILINE,
)


def strip_comments(code: str) -> str:
    """Remove /* ... */ and // ... comments before scanning for imports."""
    code = re.sub(r"/\*[\s\S]*?\*/", "", code)
    code = re.sub(r"//[^\n]*", "", code)
    return code


def resolve_in_dict(req: str, importer: str, modules: dict):
    """Simulate the browser module resolver to verify imports at build time."""
    if req in ("react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"):
        return req
    norm = req.replace("\\", "/")
    if norm.startswith("."):
        base_dir = posixpath.dirname(importer) or "."
        joined = posixpath.normpath(posixpath.join(base_dir, norm))
        if not joined.startswith("."):
            joined = "./" + joined
        norm = joined
    elif not norm.startswith("./"):
        norm_rel = "./" + norm.lstrip("/")
    else:
        norm_rel = norm

    candidates = [norm]
    if not norm.startswith("./"):
        candidates.append("./" + norm.lstrip("/"))
    for base in list(candidates):
        for ext in (".jsx", ".js", ".ts", ".tsx", ".json", ".svg", "/index.jsx", "/index.js"):
            candidates.append(base + ext)

    lower_map = {k.lower(): k for k in modules}
    for c in candidates:
        if c in modules:
            return c
        if c.lower() in lower_map:
            return lower_map[c.lower()]
    return None


RAW_GLOB_RE = re.compile(r"""import\.meta\.glob\(\s*(["'])(\./[^"']+)\1\s*,\s*\{[^}]*["']\?raw["'][^}]*eager\s*:\s*true[^}]*\}\s*\)""")


def inline_raw_globs(src_dir: Path, modules: dict):
    """Vite's eager raw glob (import.meta.glob("./x/*.json", { query: "?raw", import: "default", eager: true }), as in
    src/i18n.js) has no Babel equivalent: replace each call with the literal { "./x/a.json": "<file text>", ... }."""
    for key, code in list(modules.items()):
        if not isinstance(code, str) or key.endswith(".svg") or "import.meta.glob" not in code:
            continue
        base = (src_dir / key).parent
        def repl(m):
            files = sorted(base.glob(m.group(2)))
            print(f"[+] Inlined {len(files)} file(s) for import.meta.glob('{m.group(2)}') in {key}")
            return json.dumps({"./" + f.relative_to(base).as_posix(): f.read_text(encoding="utf-8") for f in files},
                              ensure_ascii=False)
        modules[key] = RAW_GLOB_RE.sub(repl, code)
        if "import.meta.glob" in strip_comments(modules[key]):
            print(f"[!] WARNING: {key} still uses import.meta.glob in a form bundle.py cannot inline", file=sys.stderr)


def collect_modules(src_dir: Path):
    modules = {}
    missing_jsx = [name for name in REQUIRED_JSX if not (src_dir / name).is_file()]
    if missing_jsx:
        print(f"[!] Missing required JSX files in {src_dir}: {', '.join(missing_jsx)}", file=sys.stderr)
        sys.exit(1)

    skip_dirs = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv"}

    # Auto-discover all code, JSON, and SVG files in src_dir (and subdirectories)
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
        for fname in files:
            fpath = Path(root) / fname
            ext = fpath.suffix.lower()
            rel = "./" + fpath.relative_to(src_dir).as_posix()

            if ext in CODE_EXTS:
                try:
                    modules[rel] = fpath.read_text(encoding="utf-8")
                except Exception as e:
                    print(f"[!] Could not read {rel}: {e}", file=sys.stderr)
            elif ext in DATA_EXTS and rel.startswith("./locales/"):
                continue  # read as raw text by inline_raw_globs (an empty, new locale is not valid JSON)
            elif ext in DATA_EXTS and fname != "package.json" and fname != "package-lock.json":
                try:
                    modules[rel] = json.loads(fpath.read_text(encoding="utf-8"))
                except Exception as e:
                    print(f"[!] Failed to parse JSON {rel}: {e}", file=sys.stderr)
            elif ext in ASSET_EXTS:
                try:
                    svg_text = fpath.read_text(encoding="utf-8")
                    import base64
                    b64 = base64.b64encode(svg_text.encode("utf-8")).decode("ascii")
                    modules[rel] = f"data:image/svg+xml;base64,{b64}"
                except Exception:
                    pass

    # Case JSONs come straight from the engine folders (src/puzzles is only Vite's synced copy)
    for pdir in PUZZLE_DIRS:
        for fpath in sorted(pdir.glob("shadoku_*.json")):
            modules[f"./puzzles/{fpath.name}"] = json.loads(fpath.read_text(encoding="utf-8"))
    missing_json = [name for name in JSON_PUZZLES if f"./puzzles/{name}" not in modules]
    if missing_json:
        print(f"[!] Missing engine puzzles in {', '.join(map(str, PUZZLE_DIRS))}: {', '.join(missing_json)}", file=sys.stderr)
        sys.exit(1)

    inline_raw_globs(src_dir, modules)

    # Verify all imports across every code module
    for mod_key, src in list(modules.items()):
        if not isinstance(src, str) or mod_key.endswith(".svg"):
            continue
        cleaned = strip_comments(src)
        for match in IMPORT_RE.finditer(cleaned):
            req = match.group(1)
            resolved = resolve_in_dict(req, mod_key, modules)
            if resolved is None:
                # Check if the file exists in parent directory (e.g., ../something or ./something in parent)
                cand_parent = (src_dir.parent / req.lstrip("./")).resolve()
                loaded = False
                for ext in ("", ".jsx", ".js", ".json"):
                    p = Path(str(cand_parent) + ext)
                    if p.is_file():
                        target_key = req if req.startswith(".") else f"./{req}"
                        if p.suffix.lower() == ".json":
                            modules[target_key] = json.loads(p.read_text(encoding="utf-8"))
                        else:
                            modules[target_key] = p.read_text(encoding="utf-8")
                        print(f"[+] Resolved '{req}' (imported by {mod_key}) from parent folder: {p.name}")
                        loaded = True
                        break
                if not loaded:
                    print(f"[!] WARNING: {mod_key} imports '{req}', which was not found in {src_dir}!")

    code_count = sum(1 for k, v in modules.items() if isinstance(v, str) and not k.endswith(".svg"))
    json_count = sum(1 for v in modules.values() if not isinstance(v, str))
    print(f"[+] Collected {code_count} code files and {json_count} JSON files from {src_dir}")
    return modules


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Shadoku — Local Test Bundle</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Special+Elite&display=swap" media="print" onload="this.media='all'" />
  <style>
    html, body, #root { margin: 0; padding: 0; min-height: 100vh; background: #141419; color: #F5F0E6; }
    #sh-boot-err { padding: 24px; font-family: monospace; color: #ff8a86; white-space: pre-wrap; line-height: 1.5; }
  </style>
  <script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"></script>
  <script crossorigin src="https://unpkg.com/@babel/standalone@7.26.0/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script id="shadoku-modules" type="application/json">__MODULES_JSON__</script>
  <script>
    (function () {
      const formatError = (err) => {
        if (!err) return "Unknown error";
        const msg = err.message ? String(err.message) : String(err);
        const stack = err.stack ? String(err.stack) : "";
        if (!stack) return msg;
        return stack.includes(msg) ? stack : (msg + "\\n\\n" + stack);
      };

      const errBox = (err) => {
        const el = document.getElementById("root");
        if (el) {
          const d = document.createElement("div");
          d.id = "sh-boot-err";
          d.innerHTML = "<b>Bundle Error</b>\\n\\n";
          d.appendChild(document.createTextNode(formatError(err)));
          el.innerHTML = "";
          el.appendChild(d);
        }
      };

      window.addEventListener("error", (e) => console.error(e.error || e.message));

      // Support opening index.html directly via file:// protocol
      if (window.location.protocol === "file:") {
        const getVirtualPath = () => {
          const h = window.location.hash.replace(/^#/, "");
          return h.startsWith("/") ? h : "/";
        };
        try {
          Object.defineProperty(window.location, "pathname", {
            get: getVirtualPath,
            configurable: true
          });
        } catch (_) {}
        window.history.pushState = function (_s, _t, url) {
          if (url) window.location.hash = url;
        };
        window.history.replaceState = function (_s, _t, url) {
          if (url) {
            const base = window.location.href.split("#")[0];
            window.location.replace(base + "#" + url);
          }
        };
        window.addEventListener("hashchange", () => {
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
      }

      try {
        const rawModules = JSON.parse(document.getElementById("shadoku-modules").textContent);
        const lowerMap = {};
        Object.keys(rawModules).forEach((k) => { lowerMap[k.toLowerCase()] = k; });

        // Babel's automatic JSX runtime on top of the React 18 UMD build (which has no jsx-runtime entry)
        const jsxOf = (type, props, key) => window.React.createElement(type, key === undefined ? props : { ...props, key });
        const JSX_RUNTIME = { jsx: jsxOf, jsxs: jsxOf, jsxDEV: jsxOf, Fragment: window.React.Fragment };
        const cache = {
          react: { exports: window.React },
          "react-dom": { exports: window.ReactDOM },
          "react-dom/client": { exports: window.ReactDOM },
          "react/jsx-runtime": { exports: JSX_RUNTIME },
          "react/jsx-dev-runtime": { exports: JSX_RUNTIME }
        };

        function normPath(baseDir, req) {
          const raw = String(req || "").replace(/\\\\/g, "/").trim();
          if (!raw.startsWith(".")) return raw;
          const parts = (baseDir + "/" + raw).split("/");
          const out = [];
          for (const p of parts) {
            if (!p || p === ".") continue;
            if (p === "..") out.pop();
            else out.push(p);
          }
          return "./" + out.join("/");
        }

        function resolveKey(req, fromFile) {
          if (req in cache || req in rawModules) return req;
          const baseDir = fromFile ? fromFile.replace(/\\/[^/]*$/, "") : ".";
          const norm = normPath(baseDir, req);
          const bases = [norm, req];
          if (!norm.startsWith(".")) bases.push("./" + norm.replace(/^\\/+/, ""));

          const exts = ["", ".jsx", ".js", ".ts", ".tsx", ".json", ".svg", "/index.jsx", "/index.js"];
          for (const b of bases) {
            for (const ext of exts) {
              const cand = b + ext;
              if (cand in cache || cand in rawModules) return cand;
              const low = cand.toLowerCase();
              if (low in lowerMap) return lowerMap[low];
            }
          }
          return norm;
        }

        function requireModule(req, fromFile) {
          const key = resolveKey(req, fromFile);
          if (cache[key]) return cache[key].exports;
          if (!(key in rawModules)) {
            const available = Object.keys(rawModules).join(", ");
            throw new Error(
              "Cannot find module '" + req + "' (resolved to '" + key + "')" +
              (fromFile ? " imported from '" + fromFile + "'" : "") +
              ".\\nAvailable bundled modules: " + available
            );
          }
          const src = rawModules[key];
          if (typeof src !== "string" || key.endsWith(".svg")) {
            cache[key] = { exports: src };
            return src;
          }
          const mod = { exports: {} };
          cache[key] = mod;
          let compiled;
          try {
            compiled = Babel.transform(src, {
              filename: key,
              presets: [["react", { runtime: "automatic" }]],
              plugins: ["transform-modules-commonjs"]
            }).code;
          } catch (compileErr) {
            throw new Error("Babel compile error in " + key + ":\\n" + formatError(compileErr));
          }
          const fn = new Function("require", "module", "exports", compiled);
          const localRequire = (childReq) => requireModule(childReq, key);
          fn(localRequire, mod, mod.exports);
          return mod.exports;
        }

        const AppMod = requireModule("./ShadokuApp.jsx", "./index.html");
        const ShadokuApp = AppMod.default || AppMod;
        const LabMod = "./ShadokuLab.jsx" in rawModules ? requireModule("./ShadokuLab.jsx", "./index.html") : null;
        const ShadokuLab = LabMod ? (LabMod.default || LabMod) : null;

        const root = ReactDOM.createRoot(document.getElementById("root"));
        root.render(React.createElement(ShadokuApp, { lab: ShadokuLab }));
      } catch (err) {
        console.error(err);
        errBox(err);
      }
    })();
  </script>
</body>
</html>
"""


def build_bundle(src_dir: Path, out_file: Path):
    modules = collect_modules(src_dir)
    payload = json.dumps(modules).replace("</", "<\\/")
    html = HTML_TEMPLATE.replace("__MODULES_JSON__", payload)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(html, encoding="utf-8")
    print(f"[+] Bundled {len(modules)} modules -> {out_file.resolve()}")


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    """Serves static files and falls back to the bundled HTML file for SPA routes (/play, /play/*)."""

    def __init__(self, *args, bundle_name="index.html", **kwargs):
        self.bundle_name = bundle_name
        super().__init__(*args, **kwargs)

    def do_GET(self):
        path_only = self.path.split("?", 1)[0].split("#", 1)[0]
        local_path = Path(self.translate_path(path_only))
        if not local_path.exists() and not Path(path_only).suffix:
            self.path = "/" + self.bundle_name
        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[http] {self.address_string()} - {fmt % args}\n")


def serve(directory: Path, bundle_name: str, port: int, open_browser: bool):
    handler = functools.partial(SPAHandler, directory=str(directory), bundle_name=bundle_name)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        url = f"http://127.0.0.1:{port}/"
        print(f"[+] Serving SHADOKU at {url} (Ctrl+C to stop)")
        if open_browser:
            try:
                webbrowser.open(url)
            except Exception:
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[+] Server stopped.")


def main():
    parser = argparse.ArgumentParser(description="Bundle and serve SHADOKU locally.")
    parser.add_argument("--dir", default=".", help="Directory containing the .jsx and .json files (default: .)")
    parser.add_argument("--out", default="index.html", help="Output HTML file path (default: index.html)")
    parser.add_argument("--port", type=int, default=8000, help="Port for local SPA server (default: 8000)")
    parser.add_argument("--no-serve", action="store_true", help="Only generate the HTML bundle without starting a server")
    parser.add_argument("--no-open", action="store_true", help="Do not automatically open the browser")
    args = parser.parse_args()

    src_dir = Path(args.dir).resolve()
    out_file = Path(args.out).resolve()

    build_bundle(src_dir, out_file)

    if not args.no_serve:
        serve(out_file.parent, out_file.name, args.port, not args.no_open)


if __name__ == "__main__":
    main()
