import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { fetchAndFilterInfoparkJobs } from "./infopark-mailer.js";
import { fetchAndFilterTechnoparkJobs } from "./technopark-mailer.js";
import {
  ROLE_PROFILES,
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

async function main() {
  assertFileExists(htmlTemplatePath, "HTML template");
  assertFileExists(textTemplatePath, "Text template");
  assertFileExists(followupHtmlTemplatePath, "Follow-up HTML template");
  assertFileExists(followupTextTemplatePath, "Follow-up text template");
  assertFileExists(resumePath, "Resume PDF");

  console.log("==========================================================");
  console.log("   🌟 ALL-PARKS JOB SEARCH & AUTO MAILER");
  console.log("   (Technopark Trivandrum + Infopark Kochi)");
  console.log("==========================================================");
  console.log(`Mode: ${dryRun ? "PREVIEW / DRY-RUN (No emails sent)" : "LIVE SENDING"}`);
  if (simulateDays > 0) {
    console.log(`⏱️  Simulation Mode: +${simulateDays} days offset`);
  }
  if (forceSend) {
    console.log(`⚠️  Force Mode: History skipping bypassed`);
  }

  console.log(`\n1️⃣  Scanning Technopark (technopark.in)...`);
  const { matchedCandidates: technoparkJobs } = await fetchAndFilterTechnoparkJobs("react developer", simulateDays, forceSend);
  console.log(`   Found ${technoparkJobs.length} qualified jobs on Technopark.`);

  console.log(`\n2️⃣  Scanning Infopark (infopark.in)...`);
  const { matchedCandidates: infoparkJobs } = await fetchAndFilterInfoparkJobs(["react", "frontend", "fullstack", "node"], simulateDays, forceSend);
  console.log(`   Found ${infoparkJobs.length} qualified jobs on Infopark.`);

  // Combine and deduplicate
  const allJobs = [];
  const seenEmails = new Set();

  for (const job of [...technoparkJobs, ...infoparkJobs]) {
    const normEmail = job.email.toLowerCase().trim();
    if (!seenEmails.has(normEmail)) {
      seenEmails.add(normEmail);
      allJobs.push(job);
    }
  }

  console.log(`\n==========================================================`);
  console.log(`🎉 Total Unified Qualified Jobs: ${allJobs.length}`);
  console.log(`   - Technopark: ${technoparkJobs.length}`);
  console.log(`   - Infopark:   ${infoparkJobs.length}`);
  console.log(`==========================================================`);

  if (allJobs.length === 0) {
    console.log("No qualified matching jobs found to mail right now.");
    console.log("(All available jobs were either already contacted within the last 10 days, required Python, or were unrelated).");
    return;
  }

  if (shouldSyncCsv) {
    syncToRecipientsCsv(allJobs);
  }

  let candidatesToProcess = allJobs;
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
      console.log(`\n[${index + 1}/${candidatesToProcess.length}] [${candidate.source.toUpperCase()}] [${typeLabel}] Preview:`);
      console.log(`Company:    ${candidate.companyName}`);
      console.log(`Job Title:  ${candidate.title}`);
      console.log(`Email:      ${candidate.email}`);
      console.log(`Role:       ${candidate.role.toUpperCase()} (${role.title})`);
      console.log(`Subject:    ${mail.subject}`);
      console.log(`Skills:     ${role.skills}`);
      console.log(`Attachment: ${path.basename(resumePath)}`);
      continue;
    }

    console.log(`\nSending [${index + 1}/${candidatesToProcess.length}] [${candidate.source}] [${typeLabel}] to ${candidate.companyName} (${candidate.email})...`);
    const info = await transporter.sendMail(mail);
    console.log(`✅ Sent! Message ID: ${info.messageId}`);

    // Record in history log file
    recordSent({
      email: candidate.email,
      companyName: candidate.companyName,
      jobTitle: candidate.title,
      role: candidate.role,
      source: candidate.source,
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
    console.log("Dry run finished successfully!");
    console.log("To send real emails to all candidates from both parks, run:");
    console.log("  npm run send:all");
    console.log("Or to test with 1 email first:");
    console.log("  node src/scan-all-parks.js --send --limit=1");
  } else {
    console.log("🎉 All qualified application emails sent & logged successfully!");
  }
  console.log("==========================================================");
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

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exitCode = 1;
});
