"use strict";

/**
 * Sequence of events
 * 1 - Browser calls GraphAPI: {phone-number-ID}/calls {to: <to-number>} to initiate a new call in graphAPINewCall()
 * 2 - GraphAPI: /calls api returns a new Call ID
 * 3 - Server sends Connect Webhook with Offer SDP
 * 4 - Browser makes GraphAPI:/calls {event: "connect"}  with Answer SDP in graphAPIAcceptCall()
 * 5 - Call is established
 */

/**
 * Hooking up DOM Elements
 */
const connectionStatus = document.querySelector("h2#connectionStatusText");
const audio = document.querySelector("audio#audio");

// Buttons
const serverButton = document.querySelector("button#startServerButton");
const clientButton = document.querySelector("button#startClientButton");
const oHangupButton = document.querySelector("button#oHangupButton");
const iHangupButton = document.querySelector("button#iHangupButton");
const setRemoteButton = document.querySelector("button#setRemoteButton");
const setRemoteCandidatesButton = document.querySelector(
  "button#setRemoteCandidatesButton"
);
const makeCallButton = document.querySelector("button#makeCallButton");
const acceptIncomingCallButton = document.querySelector(
  "button#acceptIncomingCallButton"
);

// Codec Selector
const codecSelector = document.querySelector("select#codec");

// TextAreas
const connectionConfiguration = document.querySelector(
  "textarea#connectionConfigurationData"
);
const LocalIceOfferData = document.querySelector("textarea#LocalIceOfferData");
const remoteIceOfferData = document.querySelector(
  "textarea#remoteIceOfferData"
);

const remoteIceCandidatesData = document.querySelector(
  "textarea#remoteIceCandidates"
);
const localIceCandidatesData = document.querySelector(
  "textarea#localIceCandidates"
);
const localDescriptionData = document.querySelector(
  "textarea#localDescriptionData"
);

// Inputs
const serverNameData = document.querySelector("input#serverNameData");
const phoneNumberData = document.querySelector("input#phoneNumberData");
const accessTokenData = document.querySelector("input#accessTokenData");
const calleeData = document.querySelector("input#calleeData");
const callerData = document.querySelector("input#callerData");
const callIdData = document.querySelector("input#callIdData");

// Checkbox
const muteMicCheckbox = document.querySelector("input#muteMic");
const useIceLiteCheckbox = document.querySelector("input#useIceLite");

/*
 * Event Listeners
 */
// Input box onblur event handlers
connectionConfiguration.addEventListener("blur", (event) => {
  connectionConfiguration.value = prettifyJSON(connectionConfiguration.value);
});
LocalIceOfferData.addEventListener("blur", (event) => {
  connectionConfiguration.value = prettifyJSON(connectionConfiguration.value);
});
remoteIceOfferData.addEventListener("blur", (event) => {
  connectionConfiguration.value = prettifyJSON(connectionConfiguration.value);
});

// Mic events
muteMicCheckbox.addEventListener("click", (e) => {
  mute_unmute();
});

/*
 * Setup buttons
 */
serverButton.onclick = server_up;
clientButton.onclick = client_up;
oHangupButton.onclick = hangup;
iHangupButton.onclick = hangup;
setRemoteButton.onclick = set_remote;
setRemoteCandidatesButton.onclick = set_remote_candidates;
makeCallButton.onclick = new_call_button;
acceptIncomingCallButton.onclick = accept_incoming_call;

// Set button states
oHangupButton.disabled = true;
iHangupButton.disabled = true;

/*
 * Setup initial variables
 */
let pc;
let isServer = false;
let localStream;
let localIceCandidates = new Set();
let connectedCallIds = new Set();

let bitrateGraph;
let bitrateSeries;
let targetBitrateSeries;
let headerrateSeries;

let rttGraph;
let rttSeries;
let totalrttSeries;

let packetGraph;
let packetSeries;

const audioLevels = [];
let audioLevelGraph;
let audioLevelSeries;

let lastResult;

let supportsSetCodecPreferences;

let intervalHandle;

let interval;


const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 0,
  voiceActivityDetection: false,
};

connectionConfiguration.value = prettifyJSON(
  JSON.stringify({
    iceServers: [
      {
        url: "stun:stun.l.google.com:19302",
      },
    ],
  })
);

/*
 * Connection Status updater
 */
function updateConnectionStatus(status) {
  console.log("Connection State: ", status);
  connectionStatus.innerHTML = status;
}

/*
 * Setup Codec Preferences
 * - We only show one way of doing this
 */
setupInitalCodecPreferencesDisplay();

/*
 * Event Handlers
 */
function server_up() {
  isServer = true;
  shared_setup();
}

function client_up() {
  shared_setup();
}

function set_remote_candidates() {
  const remoteIceCandidate = remoteIceCandidatesData.value;
  remoteIceCandidate.split(",\n").map(function (c) {
    let parsedCandidate = JSON.parse(c);
    if (typeof parsedCandidate == "string") {
      parsedCandidate = JSON.parse(parsedCandidate);
    }
    console.log("adding ice candidate: ", parsedCandidate);
    pc.addIceCandidate(parsedCandidate);
  });
}

function set_remote() {
  let remote_sdp;

  if (remoteIceOfferData.value[0] == '"') {
    remote_sdp = JSON.parse(remoteIceOfferData.value);
    if (typeof remote_sdp == "string") {
      remote_sdp = JSON.parse(remote_sdp);
    }
  } else {
    let data = remoteIceOfferData.value;
    data = data.replaceAll("\\\\r\\\\n", "\\r\\n");
    remote_sdp = JSON.parse(data);
  }

  console.debug("SET_REMOTE called with: ", remote_sdp);

  pc.setRemoteDescription(remote_sdp)
    .then(() => {
      console.debug("WebRTC: Setting remote description: ", remote_sdp);

      if (!isServer) {
        // For the client create an answer
        pc.createAnswer()
          .then((answer) => {
            console.log("LOCAL_ANSWER created: ", answer);

            LocalIceOfferData.value = JSON.stringify(JSON.stringify(answer));
            pc.setLocalDescription(answer);

            setRemoteButton.disabled = true;

            // For ice-lite send the answer
            if (useIceLiteCheckbox.checked) {
              graphAPIAcceptCallIceLite();
            }
          })
          .catch((error) => {
            console.error(error);
            setRemoteButton.disabled = false;
          });
      } else {
        setRemoteButton.disabled = true;
      }
    })
    .catch((error) => {
      console.error(error);
      setRemoteButton.disabled = false;
    });
}

function hangup() {
  console.log("Ending call");

  clearInterval(interval);

  if (callIdData.value && callIdData.value !== "") {
    graphAPITerminateCall(callIdData.value).then((resp) => {
      updateConnectionStatus("disconnected");
    });
  }

  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  pc.close();
  pc = null;

  oHangupButton.disabled = true;
  iHangupButton.disabled = true;
  makeCallButton.disabled = false;
  acceptIncomingCallButton.disabled = false;
  codecSelector.disabled = false;
  serverButton.disabled = false;
  clientButton.disabled = false;
  setRemoteButton.disabled = false;
  callIdData.value = "";
  acceptIncomingCallButton.textContent = "Receive Incoming";
}

function mute_unmute() {
  if (muteMicCheckbox.checked) {
    console.log("mute mic");
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  } else {
    console.log("unmute mic");
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
  }
}

async function shared_setup() {
  makeCallButton.disabled = true;
  codecSelector.disabled = true;
  serverButton.disabled = true;
  clientButton.disabled = true;
  acceptIncomingCallButton.disabled = true;
  oHangupButton.disabled = false;
  iHangupButton.disabled = false;

  const servers = JSON.parse(connectionConfiguration.value);
  pc = new RTCPeerConnection(servers);
  console.log("WebRTC: Created RTCPeerConnection");

  /**
   * Hooking up the RTCPeerConnection events
   */
  pc.onicegatheringstatechange = (ev) => {
    let connection = ev.target;

    console.log(
      "WebRTC: Event onicegatheringstatechange:",
      connection.iceGatheringState
    );
  };

  pc.onicecandidate = (event) => {
    console.log("WebRTC: Event onicecandidate:", event);

    if (event && event.candidate) {
      localIceCandidates.add(event.candidate);

      const result = Array.from(localIceCandidates)
        .map(function (c) {
          return JSON.stringify(JSON.stringify(c));
        })
        .join(",\n");

      localIceCandidatesData.value = result;
    }

    console.debug("Updated LOCAL_DESCRIPTION:", pc.localDescription);
    localDescriptionData.value = JSON.stringify(
      JSON.stringify(pc.localDescription)
    );
  };

  pc.onicecandidateerror = (event) => {
    console.log("WebRTC: Event onicecandidateerror:", event);
  };

  pc.onconnectionstatechange = (ev) => {
    console.log("WebRTC: Event onconnectionstatechange:", pc.connectionState);
    updateConnectionStatus(pc.connectionState);
  };

  pc.oniceconnectionstatechange = (ev) => {
    console.log("WebRTC: Event oniceconnectionstatechange:", ev);
  };

  pc.onnegotiationneeded = (ev) => {
    console.log("WebRTC: Event onnegotiationneeded:", ev);
  };

  pc.onsignalingstatechange = (ev) => {
    console.log("WebRTC: Event onsignalingstatechange:", ev);
  };

  pc.ondatachannel = (ev) => {
    console.log("WebRTC: Event ondatachannel:", ev.channel);
  };

  pc.ontrack = (event) => {
    console.log(
      "WebRTC: Event ontrack: Received remote streams %d. Hooking up track ID: %s",
      event.streams.length,
      event.streams[0].id
    );
    audio.srcObject = event.streams[0];
  };

  /**
   * Setup Media
   */
  localStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: true,
  });
  setupAudio();

  /**
   * Start the flow by creating the offer
   */
  if (isServer) {
    pc.createOffer(offerOptions).then(
      (offer) => {
        console.log("Got local Offer:", offer);
        LocalIceOfferData.value = JSON.stringify(JSON.stringify(offer));
        pc.setLocalDescription(offer);
      },
      (error) =>
        console.log(`Failed to create session description: ${error.toString()}`)
    );
  }
}

/**
 * Get the local Mic and add it to peer connection.
 */
function setupAudio() {
  const audioTracks = localStream.getAudioTracks();
  console.log("Found total %d Local Audio Tracks", audioTracks.length);
  if (audioTracks.length > 0) {
    console.log(`Using Audio device: ${audioTracks[0].label}`);
  }

  console.debug("Adding Local Stream to peer connection");
  localStream.getTracks().forEach((track) => {
    if (muteMicCheckbox.checked) {
      console.log(`Muting the track ${track.label} before adding it`);
      track.enabled = false;
    }

    console.debug(
      `Added track: ${track.label} (ID: ${track.id}) to peer connection`
    );
    pc.addTrack(track, localStream);
  });

  setCodecPreferences();
  setupGraphs();
}

/*
 * SDP Utils
 */
function setupInitalCodecPreferencesDisplay() {
  const codecPreferences = document.querySelector("#codecPreferences");
  supportsSetCodecPreferences =
    window.RTCRtpTransceiver &&
    "setCodecPreferences" in window.RTCRtpTransceiver.prototype;
  if (supportsSetCodecPreferences) {
    codecSelector.style.display = "none";

    const { codecs } = RTCRtpSender.getCapabilities("audio");
    codecs.forEach((codec) => {
      if (["audio/CN", "audio/telephone-event"].includes(codec.mimeType)) {
        return;
      }
      const option = document.createElement("option");
      option.value = (
        codec.mimeType +
        " " +
        codec.clockRate +
        " " +
        (codec.sdpFmtpLine || "")
      ).trim();
      option.innerText = option.value;
      codecPreferences.appendChild(option);
    });
    codecPreferences.disabled = false;
  } else {
    codecPreferences.style.display = "none";
  }
}

function setCodecPreferences() {
  if (supportsSetCodecPreferences) {
    console.log("Setting supportsSetCodecPreferences");
    const preferredCodec =
      codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== "") {
      const [mimeType, clockRate, sdpFmtpLine] =
        preferredCodec.value.split(" ");
      const { codecs } = RTCRtpSender.getCapabilities("audio");
      console.log(mimeType, clockRate, sdpFmtpLine);
      console.log(JSON.stringify(codecs, null, " "));
      const selectedCodecIndex = codecs.findIndex(
        (c) =>
          c.mimeType === mimeType &&
          c.clockRate === parseInt(clockRate, 10) &&
          c.sdpFmtpLine === sdpFmtpLine
      );
      const selectedCodec = codecs[selectedCodecIndex];
      codecs.splice(selectedCodecIndex, 1);
      codecs.unshift(selectedCodec);
      const transceiver = pc
        .getTransceivers()
        .find(
          (t) => t.sender && t.sender.track === localStream.getAudioTracks()[0]
        );
      transceiver.setCodecPreferences(codecs);
      console.log("Preferred video codec", selectedCodec);
    }
  }
}

// Copied from AppRTC's sdputils.js:
//  - Sets |codec| as the default |type| codec if it's present
//  - The format of |codec| is 'NAME/RATE', e.g. 'opus/48000'
function maybePreferCodec(sdp, type, dir, codec) {
  const str = `${type} ${dir} codec`;
  if (codec === "") {
    console.log(`No preference on ${str}.`);
    return sdp;
  }

  console.log(`Prefer ${str}: ${codec}`);

  const sdpLines = sdp.split("\r\n");

  // Search for m line.
  const mLineIndex = findLine(sdpLines, "m=", type);
  if (mLineIndex === null) {
    return sdp;
  }

  // If the codec is available, set it as the default in m line.
  const codecIndex = findLine(sdpLines, "a=rtpmap", codec);
  console.log("codecIndex", codecIndex);
  if (codecIndex) {
    const payload = getCodecPayloadType(sdpLines[codecIndex]);
    if (payload) {
      sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], payload);
    }
  }

  sdp = sdpLines.join("\r\n");
  return sdp;
}

// Find the line in sdpLines that starts with |prefix|, and, if specified,
// contains |substr| (case-insensitive search).
function findLine(sdpLines, prefix, substr) {
  return findLineInRange(sdpLines, 0, -1, prefix, substr);
}

// Find the line in sdpLines[startLine...endLine - 1] that starts with |prefix|
// and, if specified, contains |substr| (case-insensitive search).
function findLineInRange(sdpLines, startLine, endLine, prefix, substr) {
  const realEndLine = endLine !== -1 ? endLine : sdpLines.length;
  for (let i = startLine; i < realEndLine; ++i) {
    if (sdpLines[i].indexOf(prefix) === 0) {
      if (
        !substr ||
        sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1
      ) {
        return i;
      }
    }
  }
  return null;
}

// Gets the codec payload type from an a=rtpmap:X line.
function getCodecPayloadType(sdpLine) {
  const pattern = new RegExp("a=rtpmap:(\\d+) \\w+\\/\\d+");
  const result = sdpLine.match(pattern);
  return result && result.length === 2 ? result[1] : null;
}

// Returns a new m= line with the specified codec as the first one.
function setDefaultCodec(mLine, payload) {
  const elements = mLine.split(" ");

  // Just copy the first three parameters; codec order starts on fourth.
  const newLine = elements.slice(0, 3);

  // Put target payload first and copy in the rest.
  newLine.push(payload);
  for (let i = 3; i < elements.length; i++) {
    if (elements[i] !== payload) {
      newLine.push(elements[i]);
    }
  }
  return newLine.join(" ");
}

/*
 * Graph Utils
 */
function setupGraphs() {
  bitrateSeries = new TimelineDataSeries();
  bitrateGraph = new TimelineGraphView("bitrateGraph", "bitrateCanvas");
  bitrateGraph.updateEndDate();

  targetBitrateSeries = new TimelineDataSeries();
  targetBitrateSeries.setColor("blue");

  headerrateSeries = new TimelineDataSeries();
  headerrateSeries.setColor("green");

  packetSeries = new TimelineDataSeries();
  packetGraph = new TimelineGraphView("packetGraph", "packetCanvas");
  packetGraph.updateEndDate();

  rttSeries = new TimelineDataSeries();
  rttSeries.setColor("green");
  totalrttSeries = new TimelineDataSeries();
  totalrttSeries.setColor("blue");
  rttGraph = new TimelineGraphView("rttGraph", "rttCanvas");
  rttGraph.updateEndDate();

  audioLevelSeries = new TimelineDataSeries();
  audioLevelGraph = new TimelineGraphView(
    "audioLevelGraph",
    "audioLevelCanvas"
  );
  audioLevelGraph.updateEndDate();
}

// query getStats every second
window.setInterval(() => {
  if (!pc) {
    return;
  }
  const sender = pc.getSenders()[0];
  if (!sender) {
    return;
  }
  sender.getStats().then((res) => {
    res.forEach((report) => {
      let bytes;
      let headerBytes;
      let packets;
      if (report.type == "candidate-pair") {
        const now = report.timestamp;

        totalrttSeries.addPoint(
          now,
          (report.totalRoundTripTime / report.responsesReceived) * 1000
        );
        rttSeries.addPoint(now, report.currentRoundTripTime * 1000);
        rttGraph.setDataSeries([rttSeries, totalrttSeries]);
        rttGraph.updateEndDate();
      } else if (report.type === "outbound-rtp") {
        if (report.isRemote) {
          return;
        }
        const now = report.timestamp;
        bytes = report.bytesSent;
        headerBytes = report.headerBytesSent;

        packets = report.packetsSent;
        if (lastResult && lastResult.has(report.id)) {
          const deltaT = (now - lastResult.get(report.id).timestamp) / 1000;
          // calculate bitrate
          const bitrate =
            (8 * (bytes - lastResult.get(report.id).bytesSent)) / deltaT;
          const headerrate =
            (8 * (headerBytes - lastResult.get(report.id).headerBytesSent)) /
            deltaT;

          // append to chart
          bitrateSeries.addPoint(now, bitrate);
          headerrateSeries.addPoint(now, headerrate);
          targetBitrateSeries.addPoint(now, report.targetBitrate);
          bitrateGraph.setDataSeries([
            bitrateSeries,
            headerrateSeries,
            targetBitrateSeries,
          ]);
          bitrateGraph.updateEndDate();

          // calculate number of packets and append to chart
          packetSeries.addPoint(
            now,
            (packets - lastResult.get(report.id).packetsSent) / deltaT
          );
          packetGraph.setDataSeries([packetSeries]);
          packetGraph.updateEndDate();
        }
      }
    });
    lastResult = res;
  });
}, 1000);

if (
  window.RTCRtpReceiver &&
  "getSynchronizationSources" in window.RTCRtpReceiver.prototype
) {
  let lastTime;
  const getAudioLevel = (timestamp) => {
    window.requestAnimationFrame(getAudioLevel);
    if (!pc) {
      return;
    }
    const receiver = pc.getReceivers().find((r) => r.track.kind === "audio");
    if (!receiver) {
      return;
    }
    const sources = receiver.getSynchronizationSources();
    sources.forEach((source) => {
      audioLevels.push(source.audioLevel);
    });
    if (!lastTime) {
      lastTime = timestamp;
    } else if (timestamp - lastTime > 500 && audioLevels.length > 0) {
      // Update graph every 500ms.
      const maxAudioLevel = Math.max.apply(null, audioLevels);
      audioLevelSeries.addPoint(Date.now(), maxAudioLevel);
      audioLevelGraph.setDataSeries([audioLevelSeries]);
      audioLevelGraph.updateEndDate();
      audioLevels.length = 0;
      lastTime = timestamp;
    }
  };
  window.requestAnimationFrame(getAudioLevel);
}

/*
 * Utils
 */
function prettifyJSON(input) {
  try {
    return JSON.stringify(JSON.parse(input), undefined, 2);
  } catch (e) {
    return input;
  }
}

function getBearerToken() {
  return accessTokenData.value;
}

function getPhoneNumberId() {
  return phoneNumberData.value;
}

function getServerName() {
  return serverNameData.value;
}

/*
 * GraphAPI Functions to start/terminate/connect calls
 */
function graphAPINewCall(to) {
  console.log("GraphAPI: Starting a New Call");

  return makeGraphAPICall({
    messaging_product: "whatsapp",
    to: to,
  });
}

async function graphAPITerminateCall(callId) {
  console.log("GraphAPI: Terminate Call with ID: " + callId);

  const response = await makeGraphAPICall({
    messaging_product: "whatsapp",
    call_id: callId,
    action: "terminate",
  });

  return response;
}

async function graphAPIAcceptCall(callId, sdp) {
  console.log(
    "GraphAPI: Accept Call Action Request: ",
    LocalIceOfferData.value
  );

  const response = await makeGraphAPICall({
    messaging_product: "whatsapp",
    call_id: callId,
    action: "accept",
    connection: {
      webrtc: {
        sdp: sdp,
      },
    },
  });

  return response;
}

function graphAPIAcceptCallIceLite() {
  graphAPIAcceptCall(
    callIdData.value,
    JSON.parse(LocalIceOfferData.value)
  ).then((res) => {
    console.log("graphAPIAcceptCall returned: ", res);
  });
}

async function makeGraphAPICall(payload) {
  const data = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      host: getServerName(),
      token: getBearerToken(),
      phone_number_id: getPhoneNumberId(),
      payload: payload,
    }),
  };
  console.log(payload);
  const response = await fetch("/calling/invoke", data);
  return await response.json();
}

/**
 * Webhook Functions to handle incoming data
 */
function handleWebhookCallConnect(webhook) {
  //
  const call_id = webhook["id"];
  if (connectedCallIds.has(call_id)) {
    console.warn(
      "connect webhook already handled for this Call ID : ",
      call_id
    );
    return;
  }

  if (callIdData.value != call_id) {
    console.warn("Call ID does not match the ID in this webhook: ", webhook);
    return;
  }

  const sdp = webhook["connection"]["webrtc"]["sdp"];
  console.assert(sdp !== undefined);
  remoteIceOfferData.value = sdp;
  set_remote();
  connectedCallIds.add(call_id);
}

function handleWebhookCallTerminate(webhook) {
  const call_id = webhook["id"];
  if (callIdData.value != call_id) {
    console.error("Call ID does not match for webhook: ", webhook);
    return;
  }
  hangup();
}

const processedWebhooks = new Set();

function processWebhooks(changes) {
  if (!changes) {
    return;
  }

  changes.forEach((change) => {
    // Ignore all non call related webhooks
    if (change["field"] !== "calls") {
      return;
    }

    const change_str = JSON.stringify(change);
    console.debug(change_str);

    // If we have already processed this change then ignore it otherwise add it to the set
    if (processedWebhooks.has(change_str)) {
      return;
    }
    processedWebhooks.add(change_str);

    const call_payload = change["value"]["calls"][0];
    const webhook_type = call_payload["event"];
    switch (webhook_type) {
      case "connect":
        handleWebhookCallConnect(call_payload);
        break;
      case "terminate":
        handleWebhookCallTerminate(call_payload);
        break;
      default:
        console.log(`Unhandled webhook_type: ${webhook_type}`);
    }
  });
}

async function findCallId(caller, callee) {
  const response = await fetch(`/find_incoming_call_wacid?caller=${caller}&callee=${callee}`);
  const payload = await response.json();
  console.log(payload);
  for (const wacid in payload) {
    return wacid;
  }
  return undefined;
}

async function pollWebhooks() {
  // Find the call ID first before fetching webhooks for that call.
  if (callIdData.value === "") {
    const id = await findCallId(callerData.value, calleeData.value);
    if (id) {
      callIdData.value = id;
    } else {
      console.error("Cannot find incoming call ID");
      return;
    }
  }

  // If we are not able to find call ID then we cannot continue.
  if (callIdData.value === "") {
    console.info("No call id exists so skipping pollWebhooks()");
    return;
  }

  // Fetch webhooks for the call ID.
  const response = await fetch(`/?wacid=${callIdData.value}`);
  const changes = await response.json();
  processWebhooks(changes);
}

/**
 * Functions for Making /
 */
function new_call_button() {
  acceptIncomingCallButton.disabled = true;
  onStartCall();

  if (useIceLiteCheckbox.checked) {
    client_up();
  } else {
    server_up();
  }

  graphAPINewCall(calleeData.value)
    .then((resp) => {
      console.log("New Call Response: ", resp);
      if (resp["error"] === undefined) {
        callIdData.value = resp["calls"][0]["id"];
        console.log("Call ID: ", callIdData.value);

        // Clear the processed webhooks cache
        processedWebhooks.clear();

        // Poll for webhooks
        interval = setInterval(pollWebhooks, 1000);
      } else {
        hangup();
        alert("Error Starting New Call");
      }
    })
    .catch((err) => console.error(err));
}

function accept_incoming_call() {
  onStartCall();

  if (useIceLiteCheckbox.checked) {
    client_up();
  } else {
    server_up();
  }

  acceptIncomingCallButton.textContent = "Recieving Call...";

  // Clear the processed webhooks cache
  processedWebhooks.clear();

  interval = setInterval(pollWebhooks, 1000);
}

var coll = document.getElementsByClassName("collapsible");
var i;

for (i = 0; i < coll.length; i++) {
  coll[i].addEventListener("click", function () {
    this.classList.toggle("active");
    var content = this.nextElementSibling;
    if (content.style.display === "block") {
      content.style.display = "none";
    } else {
      content.style.display = "block";
    }
  });
}

function onStartCall() {
  updateConnectionStatus("starting");
}

async function getAppUrlPath() {
  // Fetch the webhook URL path or use the fallback.
  const response = await fetch("/app_url");
  return await response.text();
}

window.clickHandle = function clickHandle(evt, tabName) {
  let i, tabcontent, tablinks;

  // This is to clear the previous clicked content.
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }

  // Set the tab to be "active".
  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }

  // Display the clicked tab and set it to active.
  document.getElementById(tabName).style.display = "block";
  evt.currentTarget.className += " active";
  oHangupButton.disabled = true;
  iHangupButton.disabled = true;
};

document.getElementById("defaultOpen").click();
