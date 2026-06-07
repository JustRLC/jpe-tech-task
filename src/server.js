const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

const port = process.env.PORT || 3000;
const appName = process.env.APP_NAME || "Release Status Dashboard";
const environment = process.env.NODE_ENV || "development";

function getReleases() {
  const filePath = path.join(__dirname, "releases.json");
  const fileContents = fs.readFileSync(filePath, "utf8");
  return JSON.parse(fileContents);
}

app.get("/", (req, res) => {
  const releases = getReleases();

  const rows = releases
    .map(
      (release) => `
        <tr>
          <td>${release.service}</td>
          <td>${release.version}</td>
          <td>${release.environment}</td>
          <td>${release.status}</td>
          <td>${release.deployedAt}</td>
        </tr>
      `
    )
    .join("");

  res.send(`
    <html>
      <head>
        <title>${appName}</title>
      </head>
      <body>
        <h1>${appName}</h1>
        <p>Environment: ${environment}</p>

        <table border="1" cellpadding="8">
          <tr>
            <th>Service</th>
            <th>Version</th>
            <th>Environment</th>
            <th>Status</th>
            <th>Deployed At</th>
          </tr>
          ${rows}
        </table>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: appName,
    environment,
    uptime: process.uptime()
  });
});

app.get("/api/releases", (req, res) => {
  res.json(getReleases());
});

app.get("/api/config", (req, res) => {
  if (environment === "production") {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({ appName, environment });
});


if (require.main === module) {
  app.listen(port, () => {
    console.log(`${appName} listening on port ${port}`);
  });
}

module.exports = app;