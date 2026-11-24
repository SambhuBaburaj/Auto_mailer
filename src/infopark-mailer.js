import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import {
  ROLE_PROFILES,
  checkEmailStatus,
  recordSent,
} from "./mail-history.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });

// CLI arguments
const args = new Set(process.argv.slice(2));
const isSendMode = args.has("--send");
const explicitDryRun = args.has("--dry-run");
const dryRun = explicitDryRun || !isSendMode;
const shouldSyncCsv = args.has("--sync-csv");
const shouldOpenBrowser = args.has("--open");
const forceSend = args.has("--force");

const options = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...valueParts] = arg.slice(2).split("=");
      return [key, valueParts.join("=")];
    }),
);

const searchQuery = options.search || "react";
const simulateDays = Number.parseFloat(options["simulate-days"] || "0");
const htmlTemplatePath = path.join(ROOT_DIR, "templates", "application-email.html");
const textTemplatePath = path.join(ROOT_DIR, "templates", "application-email.txt");
const followupHtmlTemplatePath = path.join(ROOT_DIR, "templates", "followup-email.html");
const followupTextTemplatePath = path.join(ROOT_DIR, "templates", "followup-email.txt");
const recipientsCsvPath = path.join(ROOT_DIR, "recipients.csv");
const resumePath = path.resolve(
  ROOT_DIR,
  process.env.RESUME_PATH || "Sambhu Baburaj.pdf",
);
const sendDelayMs = Number.parseInt(process.env.SEND_DELAY_MS || "2000", 10);

export async function fetchAndFilterInfoparkJobs(searchTerms = ["react", "frontend", "fullstack", "node"], simDays = 0, bypassHistory = false) {
  const terms = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
  const matchedCandidates = [];
  const seenJobUrls = new Set();
  const seenEmails = new Set();

  const stats = {
    totalFound: 0,
    pythonSkipped: 0,
    unrelatedSkipped: 0,
    noEmailSkipped: 0,
    duplicateSkipped: 0,
    historySkipped: 0,
  };

  for (const term of terms) {
    for (let page = 1; page <= 3; page++) {
      const url = `https://infopark.in/companies-job/0?search=${encodeURIComponent(term)}&page=${page}`;
      let res;
      try {
        res = await fetch(url, {
          headers: {
            "x-requested-with": "XMLHttpRequest",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
      } catch (e) {
        console.warn(`Could not fetch Infopark ${url}: ${e.message}`);
        continue;
      }

      if (!res.ok) continue;

      let json;
      try {
        json = await res.json();
      } catch {
        continue;
      }

      const rows = [...(json.all_jobs || "").matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].slice(1);
      if (rows.length === 0) break;

      for (const r of rows) {
        const titleMatch = r[1].match(/<td class="head">([\s\S]*?)<\/td>/g);
        const companyMatch = r[1].match(/<td class="date">([\s\S]*?)<\/td>/);
        const linkMatch = r[1].match(/href="([^"]+)"/);

        const title = titleMatch && titleMatch[1] ? cleanHtml(titleMatch[1]) : "";
        const companyName = companyMatch ? cleanCompanyName(companyMatch[1]) : "Hiring Company";
        const detailLink = linkMatch ? linkMatch[1] : "";

        if (!detailLink || seenJobUrls.has(detailLink)) continue;
        seenJobUrls.add(detailLink);
        stats.totalFound++;

        if (isExcludedRole(title)) {
          stats.unrelatedSkipped++;
          continue;
        }

        // Fetch detail page
        let html = "";
        try {
          const detRes = await fetch(detailLink, {
            headers: {
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });
          if (!detRes.ok) continue;
          html = await detRes.text();
        } catch {
          continue;
        }

        const cleanDesc = cleanHtml(html);

        // Check if stack is relevant
        if (!isReactOrWebRelevant(title, cleanDesc)) {
          stats.unrelatedSkipped++;
          continue;
        }

        // Check Python requirement - MUST SKIP
        if (hasPythonRequirement(cleanDesc)) {
          stats.pythonSkipped++;
          continue;
        }

        // Extract company HR email
        const email = extractEmail(html);
        if (!email) {
          stats.noEmailSkipped++;
          continue;
        }

        if (seenEmails.has(email)) {
          stats.duplicateSkipped++;
          continue;
        }
        seenEmails.add(email);

        // Check History log
        let isFollowUp = false;
        let daysPassed = 0;
        let historyEntry = null;

        if (!bypassHistory) {
          const historyStatus = checkEmailStatus(email, simDays);
          if (historyStatus.shouldSkip) {
            stats.historySkipped++;
            continue;
          }
          isFollowUp = historyStatus.isFollowUpEligible;
          daysPassed = historyStatus.daysPassed;
          historyEntry = historyStatus.entry;
        }

        const role = detectRole(title, cleanDesc);
        matchedCandidates.push({
          source: "Infopark",
          title,
          companyName,
          email,
          role,
          url: detailLink,
          isFollowUp,
          daysPassed,
          historyEntry,
        });
      }
    }
  }

  return { matchedCandidates, stats };
}

function hasPythonRequirement(fullText) {
  return (
    /\bpython\b/i.test(fullText) ||
    /\bdjango\b/i.test(fullText) ||
    /\bflask\b/i.test(fullText) ||
    /\bfastapi\b/i.test(fullText) ||
    /\bpytorch\b/i.test(fullText) ||
    /\bodoo\b/i.test(fullText)
  );
}

function isExcludedRole(title) {
  const t = title.toLowerCase();
  const excludeKeywords = [
    "salesforce",
    "flutter",
    "android",
    "ios developer",
    "coldfusion",
    "qa engineer",
    "tester",
    "test engineer",
    "automation engineer",
    "manual test",
    "automation test",
    "business analyst",
    "program manager",
    "project coordinator",
    "scrum master",
    "data analyst",
    "hr executive",
    "recruiter",
    "market research",
    "lead generation",
    "devops",
    "system admin",
    "wordpress",
    "dropshipping",
    "seo ",
    "counsellor",
    "telecalling",
    "cultural content",
    "marketing",
    "business development",
    "erp",
    "sap",
    "sales",
    "content writer",
    "copywriter",
    "growth lead",
    "operations",
  ];
  return excludeKeywords.some((kw) => t.includes(kw));
}

function isReactOrWebRelevant(title, fullText) {
  const t = title.toLowerCase();
  const full = fullText.toLowerCase();

  if (
    (t.includes("java ") || t.includes("c#") || t.includes(".net") || t.includes("php")) &&
    !t.includes("react") &&
    !t.includes("full") &&
    !t.includes("mern") &&
    !t.includes("node") &&
    !t.includes("frontend")
  ) {
    return false;
  }

  const targetKeywords = [
    "react",
    "frontend",
    "front-end",
    "front end",
    "full stack",
    "fullstack",
    "full-stack",
    "node",
    "mern",
    "javascript",
    "ui developer",
    "ui/ux developer",
    "web developer",
    "web engineer",
    "software developer",
    "software engineer",
  ];

  if (targetKeywords.some((kw) => t.includes(kw))) {
    return true;
  }

  if (full.includes("react") || full.includes("react.js") || full.includes("reactjs")) {
    return true;
  }

  return false;
}

function detectRole(title, fullText) {
  const titleLower = title.toLowerCase();
  const textLower = fullText.toLowerCase();

  if (
    titleLower.includes("full stack") ||
    titleLower.includes("fullstack") ||
    titleLower.includes("full-stack") ||
    titleLower.includes("mern")
  ) {
    return "full";
  }

  if (
    titleLower.includes("backend") ||
    titleLower.includes("back-end") ||
    titleLower.includes("back end") ||
    (titleLower.includes("node") && !titleLower.includes("react"))
  ) {
    return "back";
  }

  if (
    titleLower.includes("frontend") ||
    titleLower.includes("front-end") ||
    titleLower.includes("front end") ||
    titleLower.includes("react") ||
    titleLower.includes("ui developer")
  ) {
    return "front";
  }

  if (textLower.includes("full stack") || textLower.includes("fullstack")) {
    return "full";
  }
  if (textLower.includes("backend") || textLower.includes("node.js")) {
    return "back";
  }

  return "front";
}

function extractEmail(html) {
  const matches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  for (const email of matches) {
    const e = email.toLowerCase().trim();
    if (
      !e.includes("infopark.in") &&
      !e.includes("clarity.ms") &&
      !e.includes("example.com") &&
      !e.includes("w3.org") &&
      !e.includes("sentry.io")
    ) {
      return e;
    }
  }
  return null;
}

function cleanHtml(str) {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCompanyName(name) {
  if (!name) return "Hiring Company";
  return name
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .trim();
}

function buildMail({ candidate, htmlTemplate, textTemplate, followupHtmlTemplate, followupTextTemplate }) {
  const role = ROLE_PROFILES[candidate.role] || ROLE_PROFILES.full;
  const isFollowUp = Boolean(candidate.isFollowUp);

  const templateData = {
    companyName: candidate.companyName,
    roleTitle: candidate.title || role.title,
    applicationLabel: role.label,
    skillsLine: role.skills,
    roleFocusParagraph: role.focus,
    followupFocusParagraph: role.followupFocus,
  };

  const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
  const fromName = process.env.MAIL_FROM_NAME || "Sambhu Baburaj";
  const from = fromEmail ? `"${fromName}" <${fromEmail}>` : `"${fromName}"`;
  const subject = isFollowUp
    ? `Follow-up: Application for ${candidate.title || role.title} - Sambhu Baburaj`
    : `Application for ${candidate.title || role.title} - Sambhu Baburaj`;

  const selectedHtml = isFollowUp ? followupHtmlTemplate : htmlTemplate;
  const selectedText = isFollowUp ? followupTextTemplate : textTemplate;

  return {
    from,
    to: candidate.email,
    subject,
    text: renderTemplate(selectedText, templateData),
    html: renderTemplate(selectedHtml, templateData, { html: true }),
    attachments: [
      {
        filename: path.basename(resumePath),
        path: resumePath,
      },
    ],
  };
}

function renderTemplate(template, data, { html = false } = {}) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const value = data[key] ?? "";
    return html ? escapeHtml(String(value)) : String(value);
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT || "465", 10),
    secure: parseBoolean(process.env.SMTP_SECURE),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function validateSmtpConfig() {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing SMTP configuration in .env: ${missing.join(", ")}`);
  }
}

function parseBoolean(value) {
  return ["true", "1", "yes", "y"].includes(String(value).trim().toLowerCase());
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at: ${filePath}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openInBrowser(url) {
  const startCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${startCmd} ${url}`, (err) => {
    if (err) console.warn("Could not automatically launch browser:", err.message);
  });
}

function syncToRecipientsCsv(candidates) {
  console.log(`\n💾 Syncing ${candidates.length} candidates to recipients.csv...`);
  let existingContent = "";
  if (fs.existsSync(recipientsCsvPath)) {
    existingContent = fs.readFileSync(recipientsCsvPath, "utf8");
  }

  const existingEmails = new Set(
    existingContent
      .split("\n")
      .map((l) => l.split(",")[2]?.trim().toLowerCase())
      .filter(Boolean),
  );

  let addedCount = 0;
  const rows = [];
  if (!existingContent.includes("enabled,companyName,email,role,subject")) {
    rows.push("enabled,companyName,email,role,subject");
  }

  for (const c of candidates) {
    if (!existingEmails.has(c.email.toLowerCase())) {
      const subject = `Application for ${c.title.replace(/,/g, " ")}`;
      const escapedCompany = `"${c.companyName.replace(/"/g, '""')}"`;
      rows.push(`true,${escapedCompany},${c.email},${c.role},${subject}`);
      existingEmails.add(c.email.toLowerCase());
      addedCount++;
    }
  }

  if (rows.length > 0) {
    const appendData = (existingContent && !existingContent.endsWith("\n") ? "\n" : "") + rows.join("\n") + "\n";
    fs.appendFileSync(recipientsCsvPath, appendData);
    console.log(`✅ Added ${addedCount} new candidate(s) to recipients.csv`);
  } else {
    console.log(`All candidates are already present in recipients.csv.`);
  }
}

async function main() {
  assertFileExists(htmlTemplatePath, "HTML template");
  assertFileExists(textTemplatePath, "Text template");
  assertFileExists(followupHtmlTemplatePath, "Follow-up HTML template");
  assertFileExists(followupTextTemplatePath, "Follow-up text template");
  assertFileExists(resumePath, "Resume PDF");

  console.log("==========================================================");
  console.log("   🚀 INFOPARK JOB SEARCH & AUTO MAILER");
  console.log("==========================================================");
  console.log(`Target: https://infopark.in/companies-job`);
  console.log(`Search Query: "${searchQuery}"`);
  console.log(`Mode: ${dryRun ? "PREVIEW / DRY-RUN (No emails sent)" : "LIVE SENDING"}`);
  if (simulateDays > 0) {
    console.log(`⏱️  Simulation Mode: +${simulateDays} days offset`);
  }
  if (forceSend) {
    console.log(`⚠️  Force Mode: History skipping bypassed`);
  }

  if (shouldOpenBrowser) {
    const url = `https://infopark.in/companies-job`;
    console.log(`🌐 Opening in browser: ${url}`);
    openInBrowser(url);
  }

  console.log(`\n🔍 Scanning Infopark job listings...`);
  const terms = options.search ? [options.search] : ["react", "frontend", "fullstack", "node"];
  const { matchedCandidates, stats } = await fetchAndFilterInfoparkJobs(terms, simulateDays, forceSend);

  console.log(`\n📊 Infopark Filtering Summary:`);
  console.log(`- Total unique jobs found: ${stats.totalFound}`);
  console.log(`- Skipped (Python required): ${stats.pythonSkipped}`);
  console.log(`- Skipped (Unrelated stack/role): ${stats.unrelatedSkipped}`);
  console.log(`- Skipped (No company email): ${stats.noEmailSkipped}`);
  console.log(`- Skipped (Already contacted <10 days): ${stats.historySkipped || 0}`);
  console.log(`- Skipped (Duplicate in current run): ${stats.duplicateSkipped}`);
  console.log(`✅ Qualified matches for you: ${matchedCandidates.length}`);

  if (matchedCandidates.length === 0) {
    console.log("\nNo qualified matching jobs found to mail right now.");
    console.log("(All available jobs were either already contacted within the last 10 days, required Python, or were unrelated).");
    return;
  }

  if (shouldSyncCsv) {
    syncToRecipientsCsv(matchedCandidates);
  }

  let candidatesToProcess = matchedCandidates;
  if (options.limit) {
    const limit = Number.parseInt(options.limit, 10);
    if (Number.isInteger(limit) && limit > 0) {
      candidatesToProcess = candidatesToProcess.slice(0, limit);
      console.log(`Applying limit: processing first ${limit} candidates.`);
    }
  }

  const htmlTemplate = fs.readFileSync(htmlTemplatePath, "utf8");
  const textTemplate = fs.readFileSync(textTemplatePath, "utf8");
  const followupHtmlTemplate = fs.readFileSync(followupHtmlTemplatePath, "utf8");
  const followupTextTemplate = fs.readFileSync(followupTextTemplatePath, "utf8");

  let transporter = null;
  if (!dryRun) {
    validateSmtpConfig();
    transporter = createTransporter();
    console.log("\nChecking SMTP connection...");
    await transporter.verify();
    console.log("✅ SMTP connection verified.\n");
  }

  console.log("\n----------------------------------------------------------");
  for (const [index, candidate] of candidatesToProcess.entries()) {
    const role = ROLE_PROFILES[candidate.role] || ROLE_PROFILES.full;
    const mail = buildMail({
      candidate,
      htmlTemplate,
      textTemplate,
      followupHtmlTemplate,
      followupTextTemplate,
    });

    const typeLabel = candidate.isFollowUp ? "🔄 FOLLOW-UP (10+ days)" : "✉️  INITIAL APPLICATION";

    if (dryRun) {
      console.log(`\n[${index + 1}/${candidatesToProcess.length}] [${typeLabel}] Preview:`);
      console.log(`Company:    ${candidate.companyName}`);
      console.log(`Job Title:  ${candidate.title}`);
      console.log(`Email:      ${candidate.email}`);
      console.log(`Role:       ${candidate.role.toUpperCase()} (${role.title})`);
      console.log(`Subject:    ${mail.subject}`);
      console.log(`Skills:     ${role.skills}`);
      console.log(`Attachment: ${path.basename(resumePath)}`);
      continue;
    }

    console.log(`\nSending [${index + 1}/${candidatesToProcess.length}] [${typeLabel}] to ${candidate.companyName} (${candidate.email})...`);
    const info = await transporter.sendMail(mail);
    console.log(`✅ Sent! Message ID: ${info.messageId}`);

    // Record in history log file
    recordSent({
      email: candidate.email,
      companyName: candidate.companyName,
      jobTitle: candidate.title,
      role: candidate.role,
      source: "Infopark",
      isFollowUp: candidate.isFollowUp,
    });

    if (index < candidatesToProcess.length - 1 && sendDelayMs > 0) {
      console.log(`Waiting ${sendDelayMs / 1000}s before next email...`);
      await sleep(sendDelayMs);
    }
  }

  if (transporter) {
    transporter.close();
  }

  console.log("\n==========================================================");
  if (dryRun) {
    console.log("Infopark dry run finished successfully!");
    console.log("To send real emails, run:");
    console.log("  npm run infopark:send");
    console.log("Or to test with 1 email first:");
    console.log("  node src/infopark-mailer.js --send --limit=1");
  } else {
    console.log("🎉 All qualified Infopark application emails sent & logged successfully!");
  }
  console.log("==========================================================");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`\n❌ Error: ${err.message}`);
    process.exitCode = 1;
  });
}
