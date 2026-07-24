import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });

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

const recipientsPath = path.resolve(ROOT_DIR, options.recipients || "recipients.csv");
const htmlTemplatePath = path.join(ROOT_DIR, "templates", "application-email.html");
const textTemplatePath = path.join(ROOT_DIR, "templates", "application-email.txt");
const resumePath = path.resolve(
  process.env.RESUME_PATH || "/Users/sambhu/Downloads/Sambhu Baburaj .pdf",
);
const defaultSubject =
  process.env.DEFAULT_SUBJECT || "Application for Frontend Developer Position";
const sendDelayMs = Number.parseInt(process.env.SEND_DELAY_MS || "1500", 10);
const highlightedStack = "Redux | PostgreSQL | Prisma | MongoDB | GraphQL | TanStack";

const ROLE_PROFILES = {
  front: {
    title: "Frontend Developer",
    label: "Frontend Developer Application",
    subject: "Application for Frontend Developer Position",
    skills: "React.js | Next.js | Redux | TanStack | GraphQL | Tailwind CSS",
    focus:
      "With over two years of hands-on experience developing scalable and responsive web applications using React.js, Next.js, Redux, Tailwind CSS, TanStack, and GraphQL, I have built strong expertise in crafting clean, high-performance user interfaces.",
  },
  back: {
    title: "Backend Developer",
    label: "Backend Developer Application",
    subject: "Application for Backend Developer Position",
    skills: "Node.js | GraphQL | PostgreSQL | Prisma | MongoDB | API Development",
    focus:
      "My experience building production web applications has given me a strong practical understanding of API-driven development, GraphQL integration, PostgreSQL and MongoDB data flows, Prisma-backed application logic, and maintainable backend workflows.",
  },
  full: {
    title: "Full Stack Developer",
    label: "Full Stack Developer Application",
    subject: "Application for Full Stack Developer Position",
    skills: "React.js | Next.js | Redux | PostgreSQL | Prisma | MongoDB | GraphQL",
    focus:
      "With over two years of hands-on experience building modern web applications, I can contribute across the full application flow, from responsive React and Next.js interfaces with Redux and TanStack to API integration, GraphQL, Prisma, PostgreSQL, MongoDB, and performance-focused delivery.",
  },
};

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  assertFileExists(recipientsPath, "Recipients CSV");
  assertFileExists(htmlTemplatePath, "HTML template");
  assertFileExists(textTemplatePath, "Text template");
  assertFileExists(resumePath, "Resume PDF");

  const recipients = readRecipients(recipientsPath);
  const enabledRecipients = recipients.filter((recipient) => recipient.enabled);
  const disabledRecipients = recipients.filter((recipient) => !recipient.enabled);
  const recipientsForThisRun = dryRun ? recipients : enabledRecipients;

  if (dryRun && disabledRecipients.length > 0) {
    console.log(`Preview includes ${disabledRecipients.length} disabled recipient(s).`);
  }

  if (!dryRun && disabledRecipients.length > 0) {
    console.log(`Skipped ${disabledRecipients.length} disabled recipient(s).`);
  }

  if (recipientsForThisRun.length === 0) {
    const message = dryRun
      ? "No recipients found in recipients.csv."
      : "No enabled recipients found. Set enabled=true in recipients.csv for at least one row.";
    throw new Error(message);
  }

  const selectedRecipients = applyCliFilters(recipientsForThisRun);
  const htmlTemplate = fs.readFileSync(htmlTemplatePath, "utf8");
  const textTemplate = fs.readFileSync(textTemplatePath, "utf8");

  if (dryRun) {
    console.log("\nDry run only. No emails will be sent.");
    console.log("Use npm run send to send real emails after checking the preview.\n");
  } else {
    validateSmtpConfig();
  }

  const transporter = dryRun ? null : createTransporter();

  if (transporter) {
    console.log("Checking SMTP connection...");
    await transporter.verify();
    console.log("SMTP connection verified.\n");
  }

  for (const [index, recipient] of selectedRecipients.entries()) {
    const mail = buildMail({
      recipient,
      htmlTemplate,
      textTemplate,
    });

    if (dryRun) {
      printPreview(index + 1, selectedRecipients.length, mail, recipient);
      continue;
    }

    console.log(`Sending ${index + 1}/${selectedRecipients.length}: ${recipient.email}`);
    const info = await transporter.sendMail(mail);
    console.log(`Sent: ${info.messageId}`);

    const hasMoreRecipients = index < selectedRecipients.length - 1;
    if (hasMoreRecipients && sendDelayMs > 0) {
      await sleep(sendDelayMs);
    }
  }

  if (transporter) {
    transporter.close();
  }

  console.log(dryRun ? "\nDry run complete." : "\nAll enabled emails sent.");
}

function readRecipients(filePath) {
  const csvText = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(csvText).filter((row) => row.some((field) => field.trim() !== ""));

  if (rows.length < 2) {
    throw new Error("recipients.csv must include a header row and at least one recipient row.");
  }

  const headers = rows[0].map((header) => header.trim());
  const requiredHeaders = ["enabled", "companyName", "email", "role", "subject"];
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) {
      throw new Error(`recipients.csv is missing required header: ${header}`);
    }
  }

  return rows.slice(1).map((row, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
    const enabled = parseBoolean(record.enabled);
    const companyName = record.companyName.trim();
    const email = record.email.trim();
    const roleKey = normalizeRole(record.role, rowIndex + 2);
    const role = ROLE_PROFILES[roleKey];
    const subject = record.subject.trim() || role.subject || defaultSubject;

    if (!companyName) {
      throw new Error(`Row ${rowIndex + 2}: companyName is required.`);
    }

    if (!isValidEmail(email)) {
      throw new Error(`Row ${rowIndex + 2}: invalid email address "${email}".`);
    }

    return {
      enabled,
      companyName,
      email,
      roleKey,
      role,
      subject,
    };
  });
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows;
}

function applyCliFilters(recipients) {
  let selectedRecipients = recipients;

  if (options.only) {
    selectedRecipients = selectedRecipients.filter(
      (recipient) => recipient.email.toLowerCase() === options.only.toLowerCase(),
    );
  }

  if (options.limit) {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("--limit must be a positive number.");
    }
    selectedRecipients = selectedRecipients.slice(0, limit);
  }

  if (selectedRecipients.length === 0) {
    throw new Error("No recipients matched your CLI filters.");
  }

  return selectedRecipients;
}

function buildMail({ recipient, htmlTemplate, textTemplate }) {
  const templateData = {
    companyName: recipient.companyName,
    roleTitle: recipient.role.title,
    applicationLabel: recipient.role.label,
    skillsLine: recipient.role.skills,
    highlightedStack,
    roleFocusParagraph: recipient.role.focus,
  };

  const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
  const fromName = process.env.MAIL_FROM_NAME || "Sambhu Baburaj";
  const from = fromEmail ? `"${fromName}" <${fromEmail}>` : `"${fromName}"`;

  return {
    from,
    to: recipient.email,
    subject: recipient.subject,
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

function normalizeRole(role, rowNumber) {
  const cleanedRole = String(role || "").trim().toLowerCase();
  const aliases = {
    front: "front",
    frontend: "front",
    "front-end": "front",
    back: "back",
    backend: "back",
    "back-end": "back",
    full: "full",
    fullstack: "full",
    "full-stack": "full",
  };

  const roleKey = aliases[cleanedRole];

  if (!roleKey) {
    throw new Error(`Row ${rowNumber}: role must be one of front, back, or full.`);
  }

  return roleKey;
}

function renderTemplate(template, data, { html = false } = {}) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const value = data[key] ?? "";
    return html ? escapeHtml(String(value)) : String(value);
  });
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
  const requiredEnvVars = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing SMTP config: ${missingEnvVars.join(", ")}. Copy .env.example to .env and fill it in.`,
    );
  }

  if (!process.env.MAIL_FROM_EMAIL && !process.env.SMTP_USER) {
    throw new Error("MAIL_FROM_EMAIL or SMTP_USER is required.");
  }
}

function parseBoolean(value) {
  return ["true", "1", "yes", "y"].includes(String(value).trim().toLowerCase());
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printPreview(index, total, mail, recipient) {
  console.log(`--- Preview ${index}/${total} ---`);
  console.log(`Enabled: ${recipient.enabled}`);
  console.log(`Role: ${recipient.roleKey} (${recipient.role.title})`);
  console.log(`From: ${mail.from}`);
  console.log(`To: ${mail.to}`);
  console.log(`Subject: ${mail.subject}`);
  console.log(`Attachment: ${mail.attachments[0].path}`);
  console.log("\nText body:");
  console.log(mail.text);
  console.log("");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
