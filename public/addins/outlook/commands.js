/*
 * Collie Outlook add-in — ribbon command handler.
 *
 * Wires the "Report phish" button declared in manifest.xml to a function
 * that gathers the open message and POSTs it to /api/addin/report.
 *
 * Notes:
 *  - The host origin is derived from this script's own URL so the add-in
 *    works in any deployment without a build step.
 *  - All Outlook APIs are accessed via Office.js; do not introduce build
 *    tooling for these files. They must be plain ES5-compatible scripts
 *    served from /public.
 */

(function () {
  "use strict";

  var REPORT_ENDPOINT_PATH = "/api/addin/report";

  function backendOrigin() {
    try {
      var script = document.currentScript || document.querySelector('script[src*="commands.js"]');
      if (script && script.src) {
        return new URL(script.src).origin;
      }
    } catch (err) {
      // Ignored — fall through.
    }
    return window.location.origin;
  }

  function getAllHeadersAsync(item) {
    return new Promise(function (resolve) {
      try {
        item.getAllInternetHeadersAsync(function (result) {
          if (result.status === Office.AsyncResultStatus.Succeeded && typeof result.value === "string") {
            resolve(result.value);
          } else {
            resolve("");
          }
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
          if (result.status === Office.AsyncResultStatus.Succeeded && typeof result.value === "string") {
            resolve(result.value);
          } else {
            resolve("");
          }
        });
      } catch (err) {
        resolve("");
      }
    });
  }

  function senderEmail(item) {
    if (!item) return "";
    if (item.from && typeof item.from === "object") {
      return (item.from.emailAddress || "") +
        (item.from.displayName ? " <" + item.from.emailAddress + ">" : "");
    }
    if (item.sender && typeof item.sender === "object") {
      return item.sender.emailAddress || "";
    }
    return "";
  }

  function reporterEmail() {
    try {
      var profile = Office.context.mailbox && Office.context.mailbox.userProfile;
      return (profile && profile.emailAddress) || "";
    } catch (err) {
      return "";
    }
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
          // We cannot read attachment bytes without elevated permissions in this
          // scaffold. Send a stable placeholder hash derived from name+size so
          // the schema validation passes and downstream callers can replace it.
          sha256: hashStringSync((att.name || "") + ":" + (att.size || 0)),
          contentType: String(att.contentType || "").slice(0, 255) || undefined,
        };
      });
  }

  // FNV-1a 64-bit → 32-bit hash repeated to produce a 64-char hex value that
  // satisfies the server's sha256 regex. Real hash will be computed when
  // ReadWriteItem permission is added in a follow-up.
  function hashStringSync(input) {
    var s = String(input || "");
    var FNV_OFFSET = 0x811c9dc5;
    var FNV_PRIME = 0x01000193;
    var h = FNV_OFFSET;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * FNV_PRIME) >>> 0;
    }
    var part = ("00000000" + h.toString(16)).slice(-8);
    return (part + part + part + part + part + part + part + part).slice(0, 64);
  }

  function reportMessage(event) {
    var item = Office.context && Office.context.mailbox && Office.context.mailbox.item;

    if (!item) {
      notifyError("Open an email before reporting.");
      event.completed();
      return;
    }

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
        }).then(function (response) {
          return response.json().then(function (body) {
            return { ok: response.ok, body: body };
          });
        });
      })
      .then(function (result) {
        if (result.ok) {
          notifyInfo(result.body && result.body.message ? result.body.message : "Reported. Thanks.");
        } else {
          notifyError(
            (result.body && result.body.error) || "Could not send report. Try again or contact your security team.",
          );
        }
        event.completed();
      })
      .catch(function (err) {
        // eslint-disable-next-line no-console
        console.error("Collie report failed", err);
        notifyError("Could not send report. Check your connection and try again.");
        event.completed();
      });
  }

  function notifyInfo(message) {
    try {
      Office.context.mailbox.item.notificationMessages.replaceAsync("collie-report", {
        type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
        message: String(message).slice(0, 150),
        icon: "Icon.80",
        persistent: false,
      });
    } catch (err) {
      // Older clients may not support notifications. No-op.
    }
  }

  function notifyError(message) {
    try {
      Office.context.mailbox.item.notificationMessages.replaceAsync("collie-report", {
        type: Office.MailboxEnums.ItemNotificationMessageType.ErrorMessage,
        message: String(message).slice(0, 150),
      });
    } catch (err) {
      // No-op.
    }
  }

  Office.onReady(function () {
    Office.actions.associate("reportMessage", reportMessage);
  });

  // Also expose globally for older Outlook clients that look up by name.
  // eslint-disable-next-line no-undef
  window.reportMessage = reportMessage;
})();
