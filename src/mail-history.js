import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const HISTORY_FILE_PATH = path.join(ROOT_DIR, "sent-history.json");

export const ROLE_PROFILES = {
  front: {
    title: "Frontend Developer - 3 Years Experience",
    label: "Frontend Developer Application - 3 Years Experience",
    subject: "Application for Frontend Developer Position - 3 Years Experience",
    followupSubject: "Follow-up: Frontend Developer Application - Sambhu Baburaj",
    skills: "React.js | Next.js | Redux | TanStack | GraphQL | Tailwind CSS",
    focus:
      "With 3 years of hands-on experience developing scalable and responsive web applications using React.js, Next.js, Redux, Tailwind CSS, TanStack, and GraphQL, I have built strong expertise in crafting clean, high-performance user interfaces.",
    followupFocus:
      "As a Frontend Developer with 3 years of hands-on experience in React.js, Next.js, Redux, TanStack, GraphQL, and modern responsive UI development, I have specialized in building accessible, high-performance web applications and clean UI architectures that deliver seamless user experiences.",
  },
  back: {
    title: "Backend Developer - 3 Years Experience",
    label: "Backend Developer Application - 3 Years Experience",
    subject: "Application for Backend Developer Position - 3 Years Experience",
    followupSubject: "Follow-up: Backend Developer Application - Sambhu Baburaj",
    skills: "Node.js | GraphQL | PostgreSQL | Prisma | MongoDB | API Development",
    focus:
      "With 3 years of experience building production web applications, I have gained a strong practical understanding of API-driven development, GraphQL integration, PostgreSQL and MongoDB data flows, Prisma-backed application logic, and maintainable backend workflows.",
    followupFocus:
      "With 3 years of experience specializing in Node.js, GraphQL, REST APIs, and database design with PostgreSQL, Prisma, and MongoDB, I have focused on building secure, robust, and scalable backend services that power fast and reliable applications.",
  },
  full: {
    title: "Full Stack Developer - 3 Years Experience",
    label: "Full Stack Developer Application - 3 Years Experience",
    subject: "Application for Full Stack Developer Position - 3 Years Experience",
    followupSubject: "Follow-up: Full Stack Developer Application - Sambhu Baburaj",
    skills: "React.js | Next.js | Redux | PostgreSQL | Prisma | MongoDB | GraphQL",
    focus:
      "With 3 years of hands-on experience building modern web applications, I can contribute across the full application flow, from responsive React and Next.js interfaces with Redux and TanStack to API integration, GraphQL, Prisma, PostgreSQL, MongoDB, and performance-focused delivery.",
    followupFocus:
      "With 3 years of experience delivering full-stack solutions across the entire JavaScript/TypeScript ecosystem—from responsive React and Next.js interfaces to scalable Node.js services with Prisma, PostgreSQL, and MongoDB—I am confident I can hit the ground running and make an immediate positive impact.",
  },
};

export function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE_PATH)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(HISTORY_FILE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Warning: Could not parse ${HISTORY_FILE_PATH}: ${err.message}. Initializing empty history.`);
    return {};
  }
}

export function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE_PATH, JSON.stringify(history, null, 2), "utf8");
}

export function recordSent({ email, companyName, jobTitle, role, source = "Manual", isFollowUp = false }) {
  const history = loadHistory();
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  if (!history[normalizedEmail]) {
    history[normalizedEmail] = {
      email: normalizedEmail,
      companyName,
      jobTitle: jobTitle || role,
      role,
      source,
      initialSentAt: now,
      lastSentAt: now,
      followUpSentAt: null,
      status: "initial_sent",
      totalMailsSent: 1,
    };
  } else if (isFollowUp) {
    history[normalizedEmail].followUpSentAt = now;
    history[normalizedEmail].lastSentAt = now;
    history[normalizedEmail].status = "followup_sent";
    history[normalizedEmail].totalMailsSent = (history[normalizedEmail].totalMailsSent || 1) + 1;
  } else {
    history[normalizedEmail].lastSentAt = now;
    history[normalizedEmail].totalMailsSent = (history[normalizedEmail].totalMailsSent || 1) + 1;
  }

  saveHistory(history);
  return history[normalizedEmail];
}

export function checkEmailStatus(email, simulateDays = 0) {
  const history = loadHistory();
  const normalizedEmail = email.toLowerCase().trim();
  const entry = history[normalizedEmail];

  if (!entry) {
    return {
      shouldSkip: false,
      isFollowUpEligible: false,
      daysPassed: 0,
      reason: "New candidate - ready for initial application",
      entry: null,
    };
  }

  const initialDate = new Date(entry.initialSentAt);
  const msPassed = Date.now() - initialDate.getTime();
  const daysPassed = msPassed / (1000 * 60 * 60 * 24) + simulateDays;

  // Case 1: Already had initial email sent, but less than 10 days ago
  if (daysPassed < 10) {
    return {
      shouldSkip: true,
      isFollowUpEligible: false,
      daysPassed: Number(daysPassed.toFixed(1)),
      reason: `Already sent ${daysPassed.toFixed(1)} day(s) ago on ${formatDate(entry.initialSentAt)} (will follow up after 10 days)`,
      entry,
    };
  }

  // Case 2: 10 or more days old, and follow-up was already sent
  if (entry.followUpSentAt) {
    return {
      shouldSkip: true,
      isFollowUpEligible: false,
      daysPassed: Number(daysPassed.toFixed(1)),
      reason: `Initial application (${formatDate(entry.initialSentAt)}) and 10-day follow-up (${formatDate(entry.followUpSentAt)}) already sent`,
      entry,
    };
  }

  // Case 3: 10 or more days old, and NO follow-up sent yet -> ELIGIBLE FOR FOLLOW-UP
  return {
    shouldSkip: false,
    isFollowUpEligible: true,
    daysPassed: Number(daysPassed.toFixed(1)),
    reason: `Initial application sent ${daysPassed.toFixed(1)} days ago (${formatDate(entry.initialSentAt)}) - eligible for 10-day follow-up!`,
    entry,
  };
}

export function getPendingFollowUps(simulateDays = 0) {
  const history = loadHistory();
  const pending = [];

  for (const entry of Object.values(history)) {
    if (entry.followUpSentAt) continue;
    const initialDate = new Date(entry.initialSentAt);
    const msPassed = Date.now() - initialDate.getTime();
    const daysPassed = msPassed / (1000 * 60 * 60 * 24) + simulateDays;

    if (daysPassed >= 10) {
      pending.push({
        ...entry,
        daysPassed: Number(daysPassed.toFixed(1)),
      });
    }
  }

  return pending;
}

function formatDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
