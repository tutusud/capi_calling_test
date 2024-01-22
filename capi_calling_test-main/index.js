"use strict";

const express = require("express");
const bodyParser = require("body-parser");
const request = require("request").defaults({ rejectUnauthorized: false });
const xhub = require("express-x-hub");
const cors = require("cors");
var https = require("node:https");
const app = express();

const PORT = process.env.PORT || 8080;

app.use(xhub({ algorithm: "sha1", secret: process.env.APP_SECRET }));
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));
app.use(express.static("public"));
app.use(express.static("calling"));

var received_updates = {};

app.get("/", function (req, res) {
  if (req.query.dequeue === "true") {
    // if dequeue is set then dequeue everything
    var updates = received_updates;
    received_updates = {};
    res.send(updates);
  } else if (req.query.wacid !== undefined) {
    // if user is asking for particular wacid then only return webhooks related to that
    const wacid = req.query.wacid;
    if (wacid in received_updates) {
      const result = received_updates[wacid];
      received_updates[wacid] = [];
      res.send(result);
    } else {
      res.send([]);
    }
  } else {
    // Otherwise dump all webhooks received so far
    res.send(received_updates);
  }
});

app.get("/find_incoming_call_wacid", function (req, res) {
  const now_epoch = Math.round(new Date().getTime() / 1000);

  // Go over all the wacid to find the incoming call
  for (let wacid in received_updates) {
    if (!received_updates[wacid]) {
      continue;
    }

    // Check each of the webhook to see if it has any change
    for (const change of received_updates[wacid]) {
      // Find a wacid that has changes in last 30 seconds
      const wacid = change["value"]["calls"][0]["id"];
      const timestamp = parseInt(change["value"]["calls"][0]["timestamp"]);
      if (now_epoch - timestamp > 30) {
        console.debug(
          `Ignoring webhook as it is older than 30 seconds. Timestamp: ${timestamp}`
        );
        continue;
      }
      let result = {};
      result[wacid] = received_updates[wacid]
      res.send(result);
      return;
    }
  }
  res.send([]);
});

app.get("/webhooks", function (req, res) {
  if (
    req.param("hub.mode") != "subscribe" ||
    req.param("hub.verify_token") != process.env.VERIFY_TOKEN
  ) {
    res.sendStatus(401);
    return;
  }

  res.send(req.param("hub.challenge"));
});

app.post("/webhooks", function (req, res) {
  if (!req.isXHubValid()) {
    console.log("Received webhooks update with invalid X-Hub-Signature");
    res.sendStatus(401);
    return;
  }
  const payload = req.body;

  // Store the changes in the dict
  payload.entry.forEach((entry) => {
    entry.changes.forEach((change) => {
      // Log the webhook
      console.log(JSON.stringify(payload, null, 2));

      if (change["field"] !== "calls") {
        console.log(
          `Ignoring a non calling webhook for field: `,
          change["field"]
        );
        return;
      }

      if (change["value"]["statuses"] != null) {
        const wacid = change["value"]["statuses"][0]["id"];
        console.log(
          `Received a status webhook for call id: ${wacid}, webhook ignored.`
        );
        return;
      }

      const wacid = change["value"]["calls"][0]["id"];

      console.log(`Received a webhook for call id: ${wacid}`);

      if (wacid !== null) {
        if (wacid in received_updates === false) {
          received_updates[wacid] = [];
        }
        received_updates[wacid].unshift(change);
      } else {
        console.error(`Unable to get wacid from webhook ${entry}`);
      }
    });
  });

  res.sendStatus(200);
});

app.post("/calling/invoke", function (req, res) {
  console.log(`Invoked Calling API`);

  const post_data = JSON.stringify(req.body["payload"]);
  const host = req.body["host"];
  const token = req.body["token"];
  const phone_number_id = req.body["phone_number_id"];
  const action = req.body["action"];

  const post_options = {
    host: host,
    port: 443,
    path: `/v14.0/${phone_number_id}/calls`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Content-Length": Buffer.byteLength(post_data),
      Authorization: `Bearer ${token}`,
    },
  };

  var post_request = https.request(post_options, (post_response) => {
    const body = [];

    post_response.on("data", (d) => {
      console.log(`BODY: ${d}`);
      body.push(d);
    });

    post_response.on("end", () => {
      const resString = Buffer.concat(body).toString();
      res.send(resString);
    });
  });

  post_request.on("error", (e) => {
    console.log(e);
    reject(e);
  });

  post_request.write(post_data);
  post_request.end();
});

app.post("/calling/invoke_get", function (req, res) {
  console.log(`Invoked Get Calling API with: `, req.body);

  const url = req.body["url"];

  const options = {
    url: url,
    strictSSL: false,
  };
  request.get(options, function (error, response, body) {
    if (error) {
      console.log(error);
      res.sendStatus(400);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.send(body);
    }
  });
});

app.get("/app_url", function (req, res) {
  if (!process.env.APP_URL_PATH) {
    console.error("APP_URL_PATHenv is not set. Please restart the app with required environment variables." );
  }
  res.send(process.env.APP_URL_PATH);
});

app.listen(PORT, function () {
  console.log("Starting webhooks server listening on port:" + PORT);
  if (process.env.APP_URL_PATH) {
    console.log("APP_URL_PATH: " + process.env.APP_URL_PATH);
  } else {
    console.error("APP_URL_PATH env is not set. Please restart the app with required environment variables." );
  }
});
