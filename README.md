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

## Files

- `recipients.csv` - company name, email, role keyword, subject, and enabled flag
- `templates/application-email.html` - HTML email template
- `templates/application-email.txt` - plain text fallback template
- `src/send-mails.js` - mail sender script
- `.env` - your private SMTP settings

Your resume path is already configured in `.env.example` as:

```text
/Users/sambhu/Downloads/Sambhu Baburaj .pdf
```
# Auto_mailer
