import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import {
  ROLE_PROFILES,
  getPendingFollowUps,
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
const htmlTemplatePath = path.join(ROOT_DIR, "templates", "followup-email.html");
const textTemplatePath = path.join(ROOT_DIR, "templates", "followup-email.txt");
const resumePath = path.resolve(
  ROOT_DIR,
  process.env.RESUME_PATH || "Sambhu Baburaj.pdf",
);
const sendDelayMs = Number.parseInt(process.env.SEND_DELAY_MS || "2000", 10);

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exitCode = 1;
});

async function main() {
  assertFileExists(htmlTemplatePath, "Follow-up HTML template");
  assertFileExists(textTemplatePath, "Follow-up text template");
  assertFileExists(resumePath, "Resume PDF");

  console.log("==========================================================");
  console.log("   📬 10-DAY JOB APPLICATION FOLLOW-UP MAILER");
  console.log("==========================================================");
  console.log(`Mode: ${dryRun ? "PREVIEW / DRY-RUN (No emails sent)" : "LIVE SENDING"}`);
  if (simulateDays > 0) {
    console.log(`⏱️  Simulation Mode: +${simulateDays} days offset`);
  }

  const pending = getPendingFollowUps(simulateDays);
  console.log(`\nFound ${pending.length} candidate(s) sent 10+ days ago awaiting follow-up.`);

  if (pending.length === 0) {
    console.log("No pending 10-day follow-ups right now.");
    console.log("Tip: Run with --simulate-days=10 to preview future follow-ups.");
    return;
  }

  let candidatesToProcess = pending;
  if (options.only) {
    candidatesToProcess = candidatesToProcess.filter(
      (c) => c.email.toLowerCase() === options.only.toLowerCase(),
    );
  }
  if (options.limit) {
    const limit = Number.parseInt(options.limit, 10);
    if (Number.isInteger(limit) && limit > 0) {
      candidatesToProcess = candidatesToProcess.slice(0, limit);
      console.log(`Applying limit: processing first ${limit} candidate(s).`);
    }
  }

  const htmlTemplate = fs.readFileSync(htmlTemplatePath, "utf8");
  const textTemplate = fs.readFileSync(textTemplatePath, "utf8");

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
    const roleKey = candidate.role || "full";
    const role = ROLE_PROFILES[roleKey] || ROLE_PROFILES.full;

    const mail = buildFollowupMail({
      candidate,
      role,
      roleKey,
      htmlTemplate,
      textTemplate,
    });

    if (dryRun) {
      console.log(`\n[${index + 1}/${candidatesToProcess.length}] Follow-Up Preview:`);
      console.log(`Company:     ${candidate.companyName}`);
      console.log(`Email:       ${candidate.email}`);
      console.log(`Initial Sent: ${candidate.initialSentAt} (${candidate.daysPassed} days ago)`);
      console.log(`Role:        ${roleKey.toUpperCase()} (${role.title})`);
      console.log(`Subject:     ${mail.subject}`);
      console.log(`Attachment:  ${path.basename(resumePath)}`);
      continue;
    }

    console.log(`\nSending follow-up [${index + 1}/${candidatesToProcess.length}] to ${candidate.companyName} (${candidate.email})...`);
    const info = await transporter.sendMail(mail);
    console.log(`✅ Sent! Message ID: ${info.messageId}`);

    // Record in history log
    recordSent({
      email: candidate.email,
      companyName: candidate.companyName,
      jobTitle: candidate.jobTitle,
      role: roleKey,
      source: candidate.source,
      isFollowUp: true,
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
    console.log("Follow-up dry run finished successfully!");
    console.log("To send real follow-up emails, run:");
    console.log("  npm run followup:send");
  } else {
    console.log("🎉 All eligible 10-day follow-up emails sent successfully!");
  }
  console.log("==========================================================");
}

function buildFollowupMail({ candidate, role, roleKey, htmlTemplate, textTemplate }) {
  const templateData = {
    companyName: candidate.companyName,
    roleTitle: candidate.jobTitle || role.title,
    applicationLabel: role.label,
    skillsLine: role.skills,
    followupFocusParagraph: role.followupFocus,
  };

  const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
  const fromName = process.env.MAIL_FROM_NAME || "Sambhu Baburaj";
  const from = fromEmail ? `"${fromName}" <${fromEmail}>` : `"${fromName}"`;
  const subject = `Follow-up: Application for ${candidate.jobTitle || role.title} - Sambhu Baburaj`;

  return {
    from,
    to: candidate.email,
    subject,
    text: renderTemplate(textTemplate, templateData),
    html: renderTemplate(htmlTemplate, templateData, { html: true }),
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
