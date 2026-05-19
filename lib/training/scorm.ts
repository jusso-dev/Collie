export type ScormQuizQuestion = {
  question: string;
  options: string[];
  answer: number;
};

export type ScormTrainingModule = {
  id: string;
  title: string;
  description: string;
  durationSeconds: number;
  contentType: string;
  contentHtml: string | null;
  topic: string;
  language: string;
  quiz: ScormQuizQuestion[] | null;
};

export type ScormPackageInput = {
  module: ScormTrainingModule;
  organisationName: string;
  activityBaseUrl: string;
};

const encoder = new TextEncoder();
let crc32Table: Uint32Array | null = null;

function bytes(value: string) {
  return encoder.encode(value);
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function identifierFor(value: string) {
  const normalized = value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "module";
}

function crcTable() {
  if (crc32Table) return crc32Table;

  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  crc32Table = table;
  return table;
}

function crc32(data: Uint8Array) {
  const table = crcTable();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  return { time, day };
}

function writeUint16(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushBytes(output: number[], data: Uint8Array) {
  for (const byte of data) output.push(byte);
}

export function createStoredZip(files: Array<{ path: string; data: string | Uint8Array; modifiedAt?: Date }>) {
  const output: number[] = [];
  const centralDirectory: number[] = [];

  for (const file of files) {
    const pathData = bytes(file.path);
    const fileData = typeof file.data === "string" ? bytes(file.data) : file.data;
    const checksum = crc32(fileData);
    const { time, day } = dosDateTime(file.modifiedAt ?? new Date());
    const localHeaderOffset = output.length;

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0x0800);
    writeUint16(output, 0);
    writeUint16(output, time);
    writeUint16(output, day);
    writeUint32(output, checksum);
    writeUint32(output, fileData.length);
    writeUint32(output, fileData.length);
    writeUint16(output, pathData.length);
    writeUint16(output, 0);
    pushBytes(output, pathData);
    pushBytes(output, fileData);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0x0800);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, time);
    writeUint16(centralDirectory, day);
    writeUint32(centralDirectory, checksum);
    writeUint32(centralDirectory, fileData.length);
    writeUint32(centralDirectory, fileData.length);
    writeUint16(centralDirectory, pathData.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, localHeaderOffset);
    pushBytes(centralDirectory, pathData);
  }

  const centralDirectoryOffset = output.length;
  output.push(...centralDirectory);

  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, files.length);
  writeUint16(output, files.length);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralDirectoryOffset);
  writeUint16(output, 0);

  return Uint8Array.from(output);
}

function buildManifest(input: ScormPackageInput) {
  const moduleIdentifier = identifierFor(input.module.id);
  const title = xmlEscape(input.module.title);
  const description = xmlEscape(input.module.description);
  const organisation = xmlEscape(input.organisationName);

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="collie_${moduleIdentifier}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="collie_org">
    <organization identifier="collie_org">
      <title>${organisation}</title>
      <item identifier="item_${moduleIdentifier}" identifierref="resource_${moduleIdentifier}">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="resource_${moduleIdentifier}" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <metadata>
        <lom xmlns="http://ltsc.ieee.org/xsd/LOM">
          <general>
            <title><string language="${xmlEscape(input.module.language)}">${title}</string></title>
            <description><string language="${xmlEscape(input.module.language)}">${description}</string></description>
          </general>
        </lom>
      </metadata>
      <file href="index.html" />
      <file href="scorm-api.js" />
    </resource>
  </resources>
</manifest>
`;
}

function buildIndexHtml(input: ScormPackageInput) {
  const trainingModule = input.module;
  const quiz = trainingModule.quiz ?? [];
  const passCount = quiz.length > 0 ? Math.max(1, Math.ceil(quiz.length * 0.67)) : 0;
  const activityId = `${input.activityBaseUrl.replace(/\/$/, "")}/training/${encodeURIComponent(trainingModule.id)}`;

  return `<!doctype html>
<html lang="${htmlEscape(trainingModule.language)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(trainingModule.title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172026; background: #f7faf9; }
    body { margin: 0; }
    main { max-width: 840px; margin: 0 auto; padding: 32px 20px 48px; }
    header { border-bottom: 1px solid #d7e0dd; margin-bottom: 24px; padding-bottom: 20px; }
    h1 { font-size: 32px; line-height: 1.15; margin: 0 0 10px; letter-spacing: 0; }
    p { line-height: 1.65; }
    .meta { color: #53645f; font-size: 14px; margin: 0; }
    .lesson { background: #fff; border: 1px solid #d7e0dd; border-radius: 8px; padding: 22px; }
    .quiz { margin-top: 22px; background: #fff; border: 1px solid #d7e0dd; border-radius: 8px; padding: 22px; }
    fieldset { border: 0; margin: 0 0 20px; padding: 0; }
    legend { font-weight: 650; margin-bottom: 10px; }
    label { display: block; margin: 8px 0; line-height: 1.45; }
    button { appearance: none; border: 0; border-radius: 8px; background: #172026; color: #fff; cursor: pointer; font: inherit; font-weight: 650; padding: 10px 14px; }
    button:disabled { cursor: not-allowed; opacity: .6; }
    .status { margin-top: 16px; font-weight: 650; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${htmlEscape(trainingModule.title)}</h1>
      <p>${htmlEscape(trainingModule.description)}</p>
      <p class="meta">${Math.max(1, Math.round(trainingModule.durationSeconds / 60))} min | ${htmlEscape(trainingModule.topic)} | ${htmlEscape(trainingModule.contentType)}</p>
    </header>
    <section class="lesson">
      ${trainingModule.contentHtml ?? "<p>No lesson content is configured.</p>"}
    </section>
    <section class="quiz" aria-labelledby="quiz-title">
      <h2 id="quiz-title">Knowledge check</h2>
      <div id="quiz-root"></div>
      <button id="complete-button" type="button">${quiz.length > 0 ? "Submit answers" : "Mark complete"}</button>
      <p id="status" class="status" role="status"></p>
    </section>
  </main>
  <script>
    window.COLLIE_SCORM_MODULE = ${JSON.stringify({
      id: trainingModule.id,
      title: trainingModule.title,
      description: trainingModule.description,
      activityId,
      quiz,
      passCount,
    })};
  </script>
  <script src="scorm-api.js"></script>
</body>
</html>
`;
}

const scormApiJs = `"use strict";
(function () {
  var module = window.COLLIE_SCORM_MODULE || { quiz: [], passCount: 0 };
  var api = null;
  var initialized = false;
  var completed = false;

  function findApi(win) {
    var attempts = 0;
    while (win && attempts < 10) {
      if (win.API) return win.API;
      attempts += 1;
      if (win.parent === win) break;
      win = win.parent;
    }
    return null;
  }

  function getApi() {
    if (api) return api;
    api = findApi(window);
    if (!api && window.opener) api = findApi(window.opener);
    return api;
  }

  function call(name, valueName, value) {
    var runtime = getApi();
    if (!runtime || typeof runtime[name] !== "function") return "";
    try {
      return typeof valueName === "string" ? runtime[name](valueName, value) : runtime[name]("");
    } catch (error) {
      return "";
    }
  }

  function setValue(name, value) {
    call("LMSSetValue", name, String(value));
  }

  function commit() {
    call("LMSCommit");
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    call("LMSInitialize");
    setValue("cmi.core.lesson_status", "incomplete");
    setValue("cmi.core.score.min", "0");
    setValue("cmi.core.score.max", "100");
    commit();
  }

  function finish() {
    if (!initialized) return;
    commit();
    call("LMSFinish");
    initialized = false;
  }

  function renderQuiz() {
    var root = document.getElementById("quiz-root");
    if (!root || !Array.isArray(module.quiz) || module.quiz.length === 0) {
      if (root) root.innerHTML = "<p>No questions are configured for this module.</p>";
      return;
    }

    root.innerHTML = module.quiz.map(function (question, questionIndex) {
      var options = (question.options || []).map(function (option, optionIndex) {
        var id = "q" + questionIndex + "-" + optionIndex;
        return "<label for=\\"" + id + "\\"><input id=\\"" + id + "\\" name=\\"q" + questionIndex + "\\" type=\\"radio\\" value=\\"" + optionIndex + "\\" required /> " + escapeHtml(option) + "</label>";
      }).join("");
      return "<fieldset><legend>" + escapeHtml(question.question || ("Question " + (questionIndex + 1))) + "</legend>" + options + "</fieldset>";
    }).join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>\\"]/g, function (char) {
      if (char === "&") return "&amp;";
      if (char === "<") return "&lt;";
      if (char === ">") return "&gt;";
      if (char === '"') return "&quot;";
      return char;
    });
  }

  function complete() {
    if (completed) return;
    var quiz = Array.isArray(module.quiz) ? module.quiz : [];
    var correct = 0;
    for (var index = 0; index < quiz.length; index += 1) {
      var selected = document.querySelector("input[name=\\"q" + index + "\\"]:checked");
      if (!selected) {
        document.getElementById("status").textContent = "Answer every question before submitting.";
        return;
      }
      if (Number(selected.value) === Number(quiz[index].answer)) correct += 1;
    }

    var score = quiz.length > 0 ? Math.round((correct / quiz.length) * 100) : 100;
    var passed = quiz.length === 0 || correct >= Number(module.passCount || 1);
    completed = true;
    setValue("cmi.core.score.raw", score);
    setValue("cmi.core.lesson_status", passed ? "passed" : "failed");
    setValue("cmi.suspend_data", JSON.stringify({ correct: correct, total: quiz.length, passed: passed }));
    commit();
    document.getElementById("status").textContent = passed
      ? "Complete. Score: " + score + "%."
      : "Not passed. Score: " + score + "%.";
    document.getElementById("complete-button").disabled = true;
  }

  document.addEventListener("DOMContentLoaded", function () {
    initialize();
    renderQuiz();
    document.getElementById("complete-button").addEventListener("click", complete);
  });
  window.addEventListener("beforeunload", finish);
}());
`;

export function buildScorm12Package(input: ScormPackageInput) {
  return createStoredZip([
    { path: "imsmanifest.xml", data: buildManifest(input) },
    { path: "index.html", data: buildIndexHtml(input) },
    { path: "scorm-api.js", data: scormApiJs },
  ]);
}

export function scormPackageFilename(module: Pick<ScormTrainingModule, "title" | "id">) {
  const slug = identifierFor(module.title).toLowerCase() || identifierFor(module.id).toLowerCase();
  return `${slug}-scorm12.zip`;
}
