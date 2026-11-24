

npm run technopark:sync
npm run technopark:send
# 1. Preview Infopark matched jobs (Dry Run - no emails sent)
npm run infopark

# 2. Preview and open Infopark in your browser
npm run infopark:open

# 3. Sync Infopark jobs into recipients.csv for Excel/manual review
npm run infopark:sync

# 4. Send emails to matched Infopark companies
npm run infopark:send

# 1. Preview all matched jobs from BOTH parks (Dry Run)
npm run scan:all

# 2. Sync all matched jobs from both parks into recipients.csv
npm run sync:all

# 3. Send emails to all matched companies across BOTH parks
npm run send:all

# 4. Safe test: send to just 1 company first
node src/scan-all-parks.js --send --limit=1
# Job Application Mailer

This project sends your job application email to multiple companies, automatically replacing `{{companyName}}`, choosing the right role-focused content from the CSV, and attaching your resume PDF.

## 1. Install

```bash
npm install
```

## 2. Add your email settings

Copy the example environment file:

```bash
cp .env.example .env
```

Then edit `.env` with your SMTP login.

For Gmail, use:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
MAIL_FROM_EMAIL=your-email@gmail.com
```

Do not use your normal Gmail password. Use an app password.

## 3. Add companies

Edit `recipients.csv`:

```csv
enabled,companyName,email,role,subject
true,Frontend Company,hr@frontendcompany.com,front,
true,Backend Company,hr@backendcompany.com,back,
true,Full Stack Company,hr@fullstackcompany.com,full,
```

Keep `enabled=false` for rows you do not want to send yet.

Role keywords:

- `front` sends a frontend-focused email.
- `back` sends a backend-focused email.
- `full` sends a full-stack-focused email.

The `subject` column is optional. If you leave it blank, the script automatically uses:

- `Application for Frontend Developer Position` for `front`
- `Application for Backend Developer Position` for `back`
- `Application for Full Stack Developer Position` for `full`

## 4. Preview first

```bash
npm run dry-run
```

This prints the generated emails without sending anything. Dry-run mode previews all rows, including rows where `enabled=false`, so you can safely check the message before enabling real sending.

## 5. Send emails

```bash
npm run send
```

Only rows with `enabled=true` are sent.

Useful safer commands:

```bash
node src/send-mails.js --dry-run --limit=1
node src/send-mails.js --send --limit=1
node src/send-mails.js --send --only=hr@addaitools.com
```

## 6. Technopark Job Search & Auto Mailer (Automated)

Automatically queries [Technopark Job Search](https://technopark.in/job-search) for **React Developer** postings, inspects each job posting, extracts company & HR email, determines whether the role is **Frontend**, **Backend**, or **Full Stack**, automatically **skips any job requiring Python/Django/Flask**, and prepares or sends the personalized application with your resume.

### Commands:
```bash
# Preview matched jobs without sending
npm run technopark

# Open browser to the Technopark search page while previewing
npm run technopark:open

# Sync matched jobs to recipients.csv for Excel/manual review
npm run technopark:sync

# Send emails directly to all matched Technopark companies
npm run technopark:send
```

## 7. Infopark Job Search & Auto Mailer (Automated)

Automatically queries [Infopark Companies & Jobs](https://infopark.in/companies-job) for **React / Frontend / Full Stack / Node** developer postings, extracts company & HR email, determines whether the role is **Frontend**, **Backend**, or **Full Stack**, automatically **skips any job requiring Python/Django/Flask**, and prepares or sends the personalized application with your resume.

### Commands:
```bash
# Preview matched Infopark jobs without sending
npm run infopark

# Open browser to Infopark while previewing
npm run infopark:open

# Sync matched Infopark jobs to recipients.csv
npm run infopark:sync

# Send emails directly to all matched Infopark companies
npm run infopark:send
```

## 8. All-Parks Combined Scanner & Mailer (Technopark + Infopark)

Scans **both Technopark and Infopark**, combines all opportunities, deduplicates by company email address, applies all Python skipping and role matching rules, and allows you to preview or send to every company across Kerala's major IT parks in one command.

### Commands:
```bash
# Preview all matched jobs across BOTH parks (Dry Run)
npm run scan:all

# Sync all matched jobs from both parks into recipients.csv
npm run sync:all

# Send emails to all matched companies across BOTH parks
npm run send:all

# Test sending to just 1 company first
node src/scan-all-parks.js --send --limit=1
```

## 9. Anti-Duplicate Logging & 10-Day Follow-Up Mailer

To ensure you **never accidentally send duplicate emails** the next day when rescanning:

1. **Persistent History Log (`sent-history.json`)**:
   Every time an email is sent (from Technopark, Infopark, or CSV), it records:
   - Recipient email & company name
   - Role applied for (`front`, `back`, `full`)
   - Job title & source
   - `initialSentAt` (ISO timestamp)
   - `followUpSentAt` (ISO timestamp)
   - Status (`initial_sent` / `followup_sent`)

2. **Smart Rescan Protection**:
   - If you rescan tomorrow or any day `< 10 days`, any company you already contacted is **automatically skipped**.
   - If a company was contacted **10 or more days ago** and hasn't received a follow-up, it automatically becomes eligible for a **Follow-Up Email**!

3. **Role-Tailored 10-Day Follow-Up Email**:
   - Automatically adapts specifically for **Frontend**, **Backend**, or **Full Stack** roles.
   - Re-attaches your resume `Sambhu Baburaj.pdf`.
   - Once a follow-up is sent, it is marked as `followup_sent` so they will not be emailed again.

### Follow-Up Commands:
```bash
# Check if any companies reached the 10-day mark (Dry Run)
npm run followup

# Test/simulate what follow-ups would be sent 10 days in the future
npm run followup:simulate

# Send 10-day follow-up emails
npm run followup:send

# Bypass history check if you ever need to re-send manually
node src/technopark-mailer.js --send --force
```

## Files

- `sent-history.json` - Persistent log of all sent applications with timestamps & statuses
- `src/mail-history.js` - History tracker, duplicate prevention, and follow-up eligibility engine
- `src/followup-mailer.js` - Automated 10-day follow-up mailer
- `src/scan-all-parks.js` - Combined scanner & mailer for both Technopark & Infopark
- `src/infopark-mailer.js` - Infopark automated search, Python filter, role detector & mailer
- `src/technopark-mailer.js` - Technopark automated search, Python filter, role detector & mailer
- `src/send-mails.js` - CSV-based bulk mail sender script
- `recipients.csv` - company name, email, role keyword, subject, and enabled flag
- `templates/application-email.html` - Initial HTML email template
- `templates/application-email.txt` - Initial plain text template
- `templates/followup-email.html` - 10-Day Follow-up HTML email template
- `templates/followup-email.txt` - 10-Day Follow-up plain text template
- `Sambhu Baburaj.pdf` - your resume attachment
- `.env` - your private SMTP settings

Your resume path is already configured in `.env.example` as:

```text
/Users/sambhu/Downloads/Sambhu Baburaj .pdf
```
# Auto_mailer
