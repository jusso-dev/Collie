/*
 * Collie Outlook add-in — taskpane handler.
 *
 * Standalone equivalent of commands.js for clients that open the add-in via
 * the task pane rather than a ribbon button (e.g. Outlook on the web mobile).
 */

(function () {
  "use strict";

  var REPORT_ENDPOINT_PATH = "/api/addin/report";

  function backendOrigin() {
    try {
      var script = document.currentScript || document.querySelector('script[src*="taskpane.js"]');
      if (script && script.src) return new URL(script.src).origin;
    } catch (err) {
      // Ignored.
    }
    return window.location.origin;
  }

  function getAllHeadersAsync(item) {
    return new Promise(function (resolve) {
      try {
        item.getAllInternetHeadersAsync(function (result) {
          resolve(result.status === Office.AsyncResultStatus.Succeeded ? String(result.value || "") : "");
        });
      } catch (err) {
        resolve("");
      }
    });
  }

  function getBodyAsync(item, format) {
    return new Promise(function (resolve) {
      try {
        item.body.getAsync(format, function (result) {
          resolve(result.status === Office.AsyncResultStatus.Succeeded ? String(result.value || "") : "");
        });
      } catch (err) {
        resolve("");
      }
    });
  }

  function senderEmail(item) {
    if (!item) return "";
    if (item.from && item.from.emailAddress) return item.from.emailAddress;
    if (item.sender && item.sender.emailAddress) return item.sender.emailAddress;
    return "";
  }

  function reporterEmail() {
    try {
      return (Office.context.mailbox.userProfile && Office.context.mailbox.userProfile.emailAddress) || "";
    } catch (err) {
      return "";
    }
  }

  function hashStringSync(input) {
    var s = String(input || "");
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    var part = ("00000000" + h.toString(16)).slice(-8);
    return (part + part + part + part + part + part + part + part).slice(0, 64);
  }

  function attachmentsMeta(item) {
    if (!item || !Array.isArray(item.attachments)) return [];
    return item.attachments
      .filter(function (att) { return att && !att.isInline; })
      .slice(0, 64)
      .map(function (att) {
        return {
          name: String(att.name || "attachment").slice(0, 512),
          size: Number(att.size || 0),
          sha256: hashStringSync((att.name || "") + ":" + (att.size || 0)),
          contentType: String(att.contentType || "").slice(0, 255) || undefined,
        };
      });
  }

  function setStatus(message, variant) {
    var el = document.getElementById("status");
    if (!el) return;
    el.textContent = message;
    el.className = "status show " + (variant || "");
  }

  function send() {
    var btn = document.getElementById("report");
    var item = Office.context && Office.context.mailbox && Office.context.mailbox.item;

    if (!item) {
      setStatus("Open an email first.", "error");
      return;
    }

    btn.disabled = true;
    setStatus("Sending report…");

    Promise.all([
      getAllHeadersAsync(item),
      getBodyAsync(item, Office.CoercionType.Text),
      getBodyAsync(item, Office.CoercionType.Html),
    ])
      .then(function (parts) {
        var payload = {
          subject: String(item.subject || ""),
          fromAddress: senderEmail(item),
          headersRaw: parts[0],
          bodyText: parts[1],
          bodyHtml: parts[2],
          attachmentsMeta: attachmentsMeta(item),
          reporterEmail: reporterEmail(),
          messageId: String(item.internetMessageId || item.itemId || ""),
          source: "outlook",
        };

        return fetch(backendOrigin() + REPORT_ENDPOINT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(function (res) {
          return res.json().then(function (body) { return { ok: res.ok, body: body }; });
        });
      })
      .then(function (result) {
        if (result.ok) {
          setStatus(result.body && result.body.message ? result.body.message : "Reported. Thanks.", "success");
        } else {
          setStatus((result.body && result.body.error) || "Could not send report.", "error");
        }
      })
      .catch(function (err) {
        // eslint-disable-next-line no-console
        console.error("Collie report failed", err);
        setStatus("Could not send report. Check your connection and try again.", "error");
      })
      .finally(function () {
        btn.disabled = false;
      });
  }

  Office.onReady(function () {
    var btn = document.getElementById("report");
    if (btn) btn.addEventListener("click", send);
  });
})();
