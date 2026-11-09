import http from "node:http";

const home = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Home</title></head>
<body><main>
  <h1>Home</h1>
  <button type="button" data-testid="go-about" id="go-about">About</button>
  <button type="button" aria-label="Load items" id="load">Load</button>
  <form id="search-form"><input name="q"/><button type="submit">Search</button></form>
</main>
<script>
document.getElementById("go-about").addEventListener("click", () => { location.href = "/about"; });
document.getElementById("load").addEventListener("click", () => fetch("/api/items").then(r => r.json()));
document.getElementById("search-form").addEventListener("submit", (e) => e.preventDefault());
</script></body></html>`;

const about = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>About</title></head>
<body><main><h1>About</h1>
  <button type="button">Dynamic action</button>
  <button type="button">Log out</button>
</main></body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";
  if (url === "/api/items") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ id: 1, name: "item" }]));
    return;
  }
  if (url === "/about") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(about);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(home);
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log("Local: http://localhost:" + port);
});
